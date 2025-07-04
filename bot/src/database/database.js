import { createClient } from '@supabase/supabase-js';

export class Database {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL и Service Role Key должны быть настроены в переменных среды');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async init() {
    try {
      // Создание таблицы пользователей
      const { error: usersError } = await this.supabase.rpc('create_users_table');
      if (usersError && !usersError.message.includes('already exists')) {
        console.error('Ошибка создания таблицы users:', usersError);
      }

      // Создание таблицы платежей
      const { error: paymentsError } = await this.supabase.rpc('create_payments_table');
      if (paymentsError && !paymentsError.message.includes('already exists')) {
        console.error('Ошибка создания таблицы payments:', paymentsError);
      }

      // Создание таблицы логов
      const { error: logsError } = await this.supabase.rpc('create_logs_table');
      if (logsError && !logsError.message.includes('already exists')) {
        console.error('Ошибка создания таблицы subscription_logs:', logsError);
      }

      console.log('База данных Supabase инициализирована');
    } catch (error) {
      console.error('Ошибка инициализации базы данных:', error);
    }
  }

  async createUser(telegramId, username, firstName, lastName) {
    try {
      const { data, error } = await this.supabase
        .from('users')
        .upsert({
          telegram_id: telegramId,
          username: username,
          first_name: firstName,
          last_name: lastName,
          status: 'inactive',
          auto_payment_enabled: false
        }, {
          onConflict: 'telegram_id'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Ошибка создания пользователя:', error);
      return await this.getUserByTelegramId(telegramId);
    }
  }

  async getUserByTelegramId(telegramId) {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Ошибка получения пользователя:', error);
      return null;
    }

    return data;
  }

  async updateUserStatus(telegramId, status, subscriptionEnd = null) {
    const { error } = await this.supabase
      .from('users')
      .update({
        status: status,
        subscription_end: subscriptionEnd
      })
      .eq('telegram_id', telegramId);

    if (error) {
      console.error('Ошибка обновления статуса пользователя:', error);
      throw error;
    }
  }

  async updateUserPaymentMethod(telegramId, paymentMethodId) {
    const { error } = await this.supabase
      .from('users')
      .update({ payment_method_id: paymentMethodId })
      .eq('telegram_id', telegramId);

    if (error) {
      console.error('Ошибка обновления payment method:', error);
      throw error;
    }
  }

  async setAutoPayment(telegramId, enabled) {
    const { error } = await this.supabase
      .from('users')
      .update({ auto_payment_enabled: enabled })
      .eq('telegram_id', telegramId);

    if (error) {
      console.error('Ошибка обновления автоплатежа:', error);
      throw error;
    }
  }

  async createPayment(userId, paymentId, amount, status, paymentMethodId = null) {
    const { error } = await this.supabase
      .from('payments')
      .insert({
        user_id: userId,
        payment_id: paymentId,
        amount: amount,
        status: status,
        payment_method_id: paymentMethodId
      });

    if (error) {
      console.error('Ошибка создания платежа:', error);
      throw error;
    }
  }

  async updatePaymentStatus(paymentId, status, confirmedAt = null) {
    const { error } = await this.supabase
      .from('payments')
      .update({
        status: status,
        confirmed_at: confirmedAt
      })
      .eq('payment_id', paymentId);

    if (error) {
      console.error('Ошибка обновления статуса платежа:', error);
      throw error;
    }
  }

  async getPaymentByPaymentId(paymentId) {
    const { data, error } = await this.supabase
      .from('payments')
      .select(`
        *,
        users!inner(telegram_id, username)
      `)
      .eq('payment_id', paymentId)
      .single();

    if (error) {
      console.error('Ошибка получения платежа:', error);
      return null;
    }

    // Преобразуем структуру для совместимости
    return {
      ...data,
      telegram_id: data.users.telegram_id,
      username: data.users.username
    };
  }

  async logSubscriptionAction(userId, action, details = null) {
    const { error } = await this.supabase
      .from('subscription_logs')
      .insert({
        user_id: userId,
        action: action,
        details: details
      });

    if (error) {
      console.error('Ошибка создания лога:', error);
      throw error;
    }
  }

  async getActiveUsersWithAutoPayment() {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('auto_payment_enabled', true)
      .eq('status', 'active')
      .not('payment_method_id', 'is', null);

    if (error) {
      console.error('Ошибка получения активных пользователей:', error);
      return [];
    }

    return data || [];
  }

  async getAllUsers() {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Ошибка получения всех пользователей:', error);
      return [];
    }

    return data || [];
  }

  async getAllPayments() {
    const { data, error } = await this.supabase
      .from('payments')
      .select(`
        *,
        users!inner(telegram_id, username)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Ошибка получения всех платежей:', error);
      return [];
    }

    // Преобразуем структуру для совместимости
    return (data || []).map(payment => ({
      ...payment,
      telegram_id: payment.users.telegram_id,
      username: payment.users.username
    }));
  }

  async getSubscriptionLogs() {
    const { data, error } = await this.supabase
      .from('subscription_logs')
      .select(`
        *,
        users!inner(telegram_id, username)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Ошибка получения логов:', error);
      return [];
    }

    // Преобразуем структуру для совместимости
    return (data || []).map(log => ({
      ...log,
      telegram_id: log.users.telegram_id,
      username: log.users.username
    }));
  }

  async getStats() {
    try {
      // Получаем статистику пользователей
      const { data: usersStats, error: usersError } = await this.supabase
        .from('users')
        .select('status, auto_payment_enabled');

      if (usersError) throw usersError;

      // Получаем статистику платежей
      const { data: paymentsStats, error: paymentsError } = await this.supabase
        .from('payments')
        .select('status, amount')
        .eq('status', 'succeeded');

      if (paymentsError) throw paymentsError;

      const totalUsers = usersStats?.length || 0;
      const activeUsers = usersStats?.filter(u => u.status === 'active').length || 0;
      const autoPaymentUsers = usersStats?.filter(u => u.auto_payment_enabled).length || 0;
      const totalPayments = paymentsStats?.length || 0;
      const totalAmount = paymentsStats?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

      return {
        totalUsers,
        activeUsers,
        totalPayments,
        totalAmount,
        autoPaymentUsers
      };
    } catch (error) {
      console.error('Ошибка получения статистики:', error);
      return {
        totalUsers: 0,
        activeUsers: 0,
        totalPayments: 0,
        totalAmount: 0,
        autoPaymentUsers: 0
      };
    }
  }
}