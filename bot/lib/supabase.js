import { createClient } from '@supabase/supabase-js';

// Конфигурация Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://vtmdyvkmoysoreqxcnwm.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0bWR5dmttb3lzb3JlcXhjbndtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDQ3ODg0NCwiZXhwIjoyMDY2MDU0ODQ0fQ.5YjJRSsix3Ct0NAGb5wtMaQu5C_Qev783NCcu7-7Iyc';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Не заданы переменные окружения SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Создаем клиент с service role ключом для полного доступа
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('✅ Supabase клиент инициализирован');

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С ПОЛЬЗОВАТЕЛЯМИ ====================

export async function addOrUpdateUser(userInfo) {
  try {
    console.log(`👤 Добавление/обновление пользователя: ${userInfo.id}`);
    
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userInfo.id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const userData = {
      id: userInfo.id,
      username: userInfo.username || null,
      first_name: userInfo.first_name || null,
      last_name: userInfo.last_name || null,
      last_activity: new Date().toISOString(),
      is_blocked: false,
      updated_at: new Date().toISOString()
    };

    if (existingUser) {
      // Обновляем существующего пользователя
      userData.message_count = (existingUser.message_count || 0) + 1;
      
      const { error } = await supabase
        .from('users')
        .update(userData)
        .eq('id', userInfo.id);

      if (error) throw error;
      console.log(`✅ Пользователь обновлен: ${userInfo.id}`);
    } else {
      // Создаем нового пользователя
      userData.first_seen = new Date().toISOString();
      userData.message_count = 1;
      userData.subscription_status = 'inactive';
      userData.created_at = new Date().toISOString();

      const { error } = await supabase
        .from('users')
        .insert(userData);

      if (error) throw error;
      console.log(`✅ Новый пользователь создан: ${userInfo.id}`);
    }

    return userData;
  } catch (error) {
    console.error('❌ Ошибка при добавлении/обновлении пользователя:', error);
    throw error;
  }
}

export async function markUserAsBlocked(userId) {
  try {
    console.log(`🚫 Блокировка пользователя: ${userId}`);
    
    const { error } = await supabase
      .from('users')
      .update({ 
        is_blocked: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) throw error;
    console.log(`✅ Пользователь заблокирован: ${userId}`);
  } catch (error) {
    console.error('❌ Ошибка при блокировке пользователя:', error);
    throw error;
  }
}

export async function getUser(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('❌ Ошибка при получении пользователя:', error);
    return null;
  }
}

export async function getAllUsers() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Ошибка при получении пользователей:', error);
    return [];
  }
}

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С СООБЩЕНИЯМИ ====================

export async function addMessage(userId, text, isFromBot = false, messageType = 'text') {
  try {
    console.log(`💬 Добавление сообщения от пользователя ${userId}: ${text.substring(0, 50)}...`);
    
    const { error } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        text: text,
        is_from_bot: isFromBot,
        message_type: messageType,
        created_at: new Date().toISOString()
      });

    if (error) throw error;
    console.log(`✅ Сообщение добавлено для пользователя: ${userId}`);
  } catch (error) {
    console.error('❌ Ошибка при добавлении сообщения:', error);
    throw error;
  }
}

export async function getMessages(userId) {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Ошибка при получении сообщений:', error);
    return [];
  }
}

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАЯВКАМИ НА ВСТУПЛЕНИЕ ====================

export async function addJoinRequest(requestData) {
  try {
    console.log(`📥 Добавление заявки на вступление от пользователя: ${requestData.userId}`);
    
    // Проверяем, есть ли уже pending заявка от этого пользователя
    const { data: existingRequest } = await supabase
      .from('join_requests')
      .select('*')
      .eq('chat_id', requestData.chatId)
      .eq('user_id', requestData.userId)
      .eq('status', 'pending')
      .single();

    if (existingRequest) {
      console.log(`⚠️ Заявка от пользователя ${requestData.userId} уже существует`);
      return existingRequest;
    }

    const { data, error } = await supabase
      .from('join_requests')
      .insert({
        chat_id: requestData.chatId,
        chat_title: requestData.chatTitle,
        user_id: requestData.userId,
        status: requestData.status || 'pending',
        request_date: requestData.date,
        processed_at: requestData.processed_at || null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    console.log(`✅ Заявка на вступление добавлена: ${requestData.userId}`);
    return data;
  } catch (error) {
    console.error('❌ Ошибка при добавлении заявки на вступление:', error);
    throw error;
  }
}

export async function updateJoinRequestStatus(chatId, userId, status) {
  try {
    console.log(`🔄 Обновление статуса заявки: ${userId} -> ${status}`);
    
    const { error } = await supabase
      .from('join_requests')
      .update({ 
        status: status,
        processed_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (error) throw error;
    console.log(`✅ Статус заявки обновлен: ${userId} -> ${status}`);
  } catch (error) {
    console.error('❌ Ошибка при обновлении статуса заявки:', error);
    throw error;
  }
}

export async function getJoinRequests() {
  try {
    const { data, error } = await supabase
      .from('join_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Ошибка при получении заявок на вступление:', error);
    return [];
  }
}

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С ПОДПИСКАМИ ====================

export async function addSubscription(userId, paymentId, amount, duration = 30, paymentSystem = 'yukassa') {
  try {
    console.log(`💳 Создание подписки для пользователя: ${userId} через ${paymentSystem}`);
    
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        payment_id: paymentId,
        amount: amount,
        duration: duration,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        status: 'active',
        payment_system: paymentSystem,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Обновляем статус подписки пользователя
    await supabase
      .from('users')
      .update({ 
        subscription_status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    console.log(`✅ Подписка создана для пользователя: ${userId} через ${paymentSystem}`);
    return data;
  } catch (error) {
    console.error('❌ Ошибка при создании подписки:', error);
    throw error;
  }
}

export async function isSubscriptionActive(userId) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      // Обновляем статус пользователя
      await supabase
        .from('users')
        .update({ 
          subscription_status: 'inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
      return false;
    }

    const now = new Date();
    const activeSubscription = data.find(sub => {
      const endDate = new Date(sub.end_date);
      return endDate > now;
    });

    if (!activeSubscription) {
      // Помечаем истекшие подписки
      const expiredIds = data
        .filter(sub => new Date(sub.end_date) <= now)
        .map(sub => sub.id);

      if (expiredIds.length > 0) {
        await supabase
          .from('subscriptions')
          .update({ 
            status: 'expired',
            updated_at: new Date().toISOString()
          })
          .in('id', expiredIds);
      }

      // Обновляем статус пользователя
      await supabase
        .from('users')
        .update({ 
          subscription_status: 'inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Ошибка при проверке подписки:', error);
    return false;
  }
}

export async function getUserSubscription(userId) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('❌ Ошибка при получении подписки пользователя:', error);
    return null;
  }
}

export async function getAllSubscriptions() {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Ошибка при получении подписок:', error);
    return [];
  }
}

export async function updateSubscriptionStatus(subscriptionId, userId, newStatus) {
  try {
    console.log(`🔄 Обновление статуса подписки: ${subscriptionId} -> ${newStatus}`);
    
    const { error } = await supabase
      .from('subscriptions')
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', subscriptionId);

    if (error) throw error;

    // Обновляем статус пользователя
    const userStatus = newStatus === 'active' ? 'active' : 'inactive';
    await supabase
      .from('users')
      .update({ 
        subscription_status: userStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    console.log(`✅ Статус подписки обновлен: ${subscriptionId} -> ${newStatus}`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка при обновлении статуса подписки:', error);
    return false;
  }
}

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С ПЛАТЕЖАМИ ====================

export async function addPayment(userId, paymentId, amount, status = 'pending', confirmationUrl = null, paymentSystem = 'yukassa') {
  try {
    console.log(`💰 Добавление платежа: ${paymentId} для пользователя ${userId} через ${paymentSystem}`);
    
    const { data, error } = await supabase
      .from('payments')
      .insert({
        user_id: userId,
        payment_id: paymentId,
        amount: amount,
        status: status,
        confirmation_url: confirmationUrl,
        payment_system: paymentSystem,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    console.log(`✅ Платеж добавлен: ${paymentId} для пользователя ${userId} через ${paymentSystem}`);
    return data;
  } catch (error) {
    console.error('❌ Ошибка при добавлении платежа:', error);
    throw error;
  }
}

export async function updatePaymentStatus(paymentId, status) {
  try {
    console.log(`💳 Обновление статуса платежа: ${paymentId} -> ${status}`);
    
    const { data, error } = await supabase
      .from('payments')
      .update({ 
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('payment_id', paymentId)
      .select()
      .single();

    if (error) throw error;
    console.log(`✅ Статус платежа обновлен: ${paymentId} -> ${status}`);
    return data;
  } catch (error) {
    console.error('❌ Ошибка при обновлении статуса платежа:', error);
    return null;
  }
}

export async function getPaymentByPaymentId(paymentId) {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_id', paymentId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('❌ Ошибка при поиске платежа:', error);
    return null;
  }
}

export async function getAllPayments() {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Ошибка при получении платежей:', error);
    return [];
  }
}

// ==================== ФУНКЦИИ ДЛЯ СТАТИСТИКИ ====================

export async function getStats() {
  try {
    console.log('📊 Получение статистики...');
    
    const [usersResult, messagesResult, joinRequestsResult, subscriptionsResult, paymentsResult] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('messages').select('*'),
      supabase.from('join_requests').select('*'),
      supabase.from('subscriptions').select('*'),
      supabase.from('payments').select('*')
    ]);

    const users = usersResult.data || [];
    const messages = messagesResult.data || [];
    const joinRequests = joinRequestsResult.data || [];
    const subscriptions = subscriptionsResult.data || [];
    const payments = paymentsResult.data || [];

    const totalUsers = users.length;
    const activeUsers = users.filter(user => !user.is_blocked).length;
    const blockedUsers = users.filter(user => user.is_blocked).length;
    const totalMessages = messages.length;
    
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentUsers = users.filter(user => 
      new Date(user.last_activity) > dayAgo
    ).length;
    
    const totalJoinRequests = joinRequests.length;
    const pendingJoinRequests = joinRequests.filter(req => req.status === 'pending').length;
    const approvedJoinRequests = joinRequests.filter(req => req.status === 'approved').length;
    const declinedJoinRequests = joinRequests.filter(req => req.status === 'declined').length;
    
    const now = new Date();
    const activeSubscriptions = subscriptions.filter(sub => {
      const endDate = new Date(sub.end_date);
      return sub.status === 'active' && endDate > now;
    }).length;
    
    const expiredSubscriptions = subscriptions.filter(sub => {
      const endDate = new Date(sub.end_date);
      return sub.status === 'active' && endDate <= now;
    }).length;
    
    const totalSubscriptions = subscriptions.length;
    const totalPayments = payments.length;
    const successfulPayments = payments.filter(p => p.status === 'succeeded' || p.status === 'paid').length;
    const pendingPayments = payments.filter(p => p.status === 'pending' || p.status === 'created').length;
    const totalRevenue = payments
      .filter(p => p.status === 'succeeded' || p.status === 'paid')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Статистика по платежным системам
    const yukassaPayments = payments.filter(p => p.payment_system === 'yukassa' || !p.payment_system).length;
    const cryptocloudPayments = payments.filter(p => p.payment_system === 'cryptocloud').length;

    const stats = {
      totalUsers,
      activeUsers,
      blockedUsers,
      totalMessages,
      recentUsers,
      totalJoinRequests,
      pendingJoinRequests,
      approvedJoinRequests,
      declinedJoinRequests,
      paidUsers: activeSubscriptions,
      unpaidUsers: totalUsers - activeSubscriptions,
      totalSubscriptions,
      activeSubscriptions,
      expiredSubscriptions,
      totalPayments,
      successfulPayments,
      pendingPayments,
      totalRevenue,
      yukassaPayments,
      cryptocloudPayments
    };

    console.log('✅ Статистика получена:', stats);
    return stats;
  } catch (error) {
    console.error('❌ Ошибка при получении статистики:', error);
    throw error;
  }
}