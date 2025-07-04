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

  // === МЕТОДЫ ДЛЯ УПРАВЛЕНИЯ КАНАЛОМ ===

  // Создание запроса на вступление в канал
  async createChannelRequest(userId, username, firstName, lastName) {
    try {
      console.log(`📝 Создаем запрос на вступление в канал для пользователя ${userId}`);
      
      const { data, error } = await this.supabase
        .from('channel_requests')
        .upsert({
          user_id: userId,
          username: username,
          first_name: firstName,
          last_name: lastName,
          status: 'pending',
          request_date: new Date().toISOString()
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (error) {
        // Если запрос уже существует, обновляем его
        if (error.code === '23505') {
          console.log(`🔄 Обновляем существующий запрос для пользователя ${userId}`);
          const { data: updateData, error: updateError } = await this.supabase
            .from('channel_requests')
            .update({
              username: username,
              first_name: firstName,
              last_name: lastName,
              status: 'pending',
              request_date: new Date().toISOString(),
              processed_date: null,
              processed_by: null
            })
            .eq('user_id', userId)
            .select()
            .single();

          if (updateError) throw updateError;
          return updateData;
        }
        throw error;
      }

      console.log(`✅ Запрос на вступление создан для пользователя ${userId}`);
      return data;
    } catch (error) {
      console.error('Ошибка создания запроса на вступление:', error);
      throw error;
    }
  }

  // Получение всех запросов на вступление в канал
  async getChannelRequests() {
    try {
      console.log('📋 Получаем все запросы на вступление в канал');
      
      const { data, error } = await this.supabase
        .from('channel_requests')
        .select('*')
        .order('request_date', { ascending: false });

      if (error) throw error;

      // Обогащаем данные информацией о пользователях из основной таблицы
      const enrichedRequests = await Promise.all(
        (data || []).map(async (request) => {
          const user = await this.getUserByTelegramId(request.user_id);
          return {
            ...request,
            is_registered: !!user,
            subscription_status: user?.status || 'none',
            auto_payment_enabled: user?.auto_payment_enabled || false
          };
        })
      );

      console.log(`✅ Получено ${enrichedRequests.length} запросов на вступление`);
      return enrichedRequests;
    } catch (error) {
      console.error('Ошибка получения запросов на вступление:', error);
      return [];
    }
  }

  // Получение статистики канала
  async getChannelStats() {
    try {
      console.log('📊 Получаем статистику канала');
      
      // Получаем все запросы
      const { data: requests, error: requestsError } = await this.supabase
        .from('channel_requests')
        .select('status, user_id');

      if (requestsError) throw requestsError;

      // Получаем всех пользователей
      const { data: users, error: usersError } = await this.supabase
        .from('users')
        .select('telegram_id, status, auto_payment_enabled');

      if (usersError) throw usersError;

      const totalRequests = requests?.length || 0;
      const pendingRequests = requests?.filter(r => r.status === 'pending').length || 0;
      const approvedRequests = requests?.filter(r => r.status === 'approved').length || 0;
      const declinedRequests = requests?.filter(r => r.status === 'declined').length || 0;

      // Подсчитываем зарегистрированных и незарегистрированных пользователей среди запросов
      const userIds = new Set(users?.map(u => u.telegram_id) || []);
      const registeredUsers = requests?.filter(r => userIds.has(r.user_id)).length || 0;
      const unregisteredUsers = totalRequests - registeredUsers;

      const activeSubscribers = users?.filter(u => u.status === 'active').length || 0;
      
      // Примерное количество участников канала (в реальности получается через Bot API)
      const channelMembers = approvedRequests + activeSubscribers;

      const stats = {
        totalRequests,
        pendingRequests,
        approvedRequests,
        declinedRequests,
        registeredUsers,
        unregisteredUsers,
        activeSubscribers,
        channelMembers
      };

      console.log('✅ Статистика канала получена:', stats);
      return stats;
    } catch (error) {
      console.error('Ошибка получения статистики канала:', error);
      return {
        totalRequests: 0,
        pendingRequests: 0,
        approvedRequests: 0,
        declinedRequests: 0,
        registeredUsers: 0,
        unregisteredUsers: 0,
        activeSubscribers: 0,
        channelMembers: 0
      };
    }
  }

  // Обновление статуса запроса на вступление
  async updateChannelRequestStatus(requestId, status, processedBy = 'admin') {
    try {
      console.log(`🔄 Обновляем статус запроса ${requestId} на ${status}`);
      
      const { data, error } = await this.supabase
        .from('channel_requests')
        .update({
          status: status,
          processed_date: new Date().toISOString(),
          processed_by: processedBy
        })
        .eq('id', requestId)
        .select()
        .single();

      if (error) throw error;

      console.log(`✅ Статус запроса ${requestId} обновлен на ${status}`);
      return data;
    } catch (error) {
      console.error('Ошибка обновления статуса запроса:', error);
      throw error;
    }
  }

  // Получение запроса по ID
  async getChannelRequestById(requestId) {
    try {
      const { data, error } = await this.supabase
        .from('channel_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Ошибка получения запроса по ID:', error);
      return null;
    }
  }

  // Получение запроса по Telegram ID пользователя
  async getChannelRequestByUserId(userId) {
    try {
      const { data, error } = await this.supabase
        .from('channel_requests')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('Ошибка получения запроса по user ID:', error);
      return null;
    }
  }

  // Удаление старых обработанных запросов (для очистки)
  async cleanupOldChannelRequests(daysOld = 30) {
    try {
      console.log(`🧹 Очистка запросов старше ${daysOld} дней`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { data, error } = await this.supabase
        .from('channel_requests')
        .delete()
        .neq('status', 'pending')
        .lt('processed_date', cutoffDate.toISOString())
        .select();

      if (error) throw error;

      console.log(`✅ Удалено ${data?.length || 0} старых запросов`);
      return data?.length || 0;
    } catch (error) {
      console.error('Ошибка очистки старых запросов:', error);
      return 0;
    }
  }
}