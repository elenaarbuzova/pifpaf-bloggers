export function humanizeApifyError(raw) {
  const msg = String(raw || '').toLowerCase();

  if (msg.includes('restricted') || msg.includes('age')) {
    return 'Reel с возрастным ограничением — Instagram не отдаёт данные. Попробуй другую ссылку.';
  }
  if (msg.includes('not exist') || msg.includes('not_found') || msg.includes('404')) {
    return 'Reel не найден — возможно, его удалили или ссылка битая.';
  }
  if (msg.includes('private')) {
    return 'Reel приватный — мы можем подтянуть только публичные видео.';
  }
  if (msg.includes('apify_token') || msg.includes('token')) {
    return 'Не настроен APIFY_TOKEN — попроси админа добавить ключ в .env.';
  }
  if (msg.includes('username is required')) {
    return 'Ошибка интеграции с Apify — мы уже чиним, попробуй обновить позже.';
  }
  if (msg.includes('fetch failed') || msg.includes('timeout')) {
    return 'Instagram временно не ответил — нажми «Обновить» через минуту.';
  }
  if (msg.includes('другой рил')) {
    return 'Apify вернул другой рил — проверь, что ссылка ведёт на нужное видео.';
  }

  return String(raw).slice(0, 200);
}
