/** Тимчасовий пароль без схожих символів (0/O, 1/l/I), 10 знаків. */
export function generatePassword(len = 10): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}

const RPC_ERRORS: Record<string, string> = {
  FORBIDDEN: 'Недостатньо прав — дія доступна лише адміністратору.',
  BAD_EMAIL: 'Некоректний email.',
  WEAK_PASSWORD: 'Пароль має містити щонайменше 8 символів.',
  BAD_ROLE: 'Невідома роль.',
  USER_EXISTS: 'Акаунт із цим email уже існує — скористайтеся «Тимчасовий пароль».',
  NOT_IN_TEAM: 'Цього email немає в команді.',
  NO_ACCOUNT: 'У цього учасника ще немає акаунта — спершу створіть його.',
  USE_CHANGE_PASSWORD: 'Свій пароль змінюйте через кнопку «Змінити пароль» угорі.',
}

export function rpcError(message: string): string {
  const key = Object.keys(RPC_ERRORS).find((k) => message.includes(k))
  return key ? RPC_ERRORS[key] : message
}
