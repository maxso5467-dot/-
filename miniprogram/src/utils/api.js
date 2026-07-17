import Taro from '@tarojs/taro'

const API_BASE = process.env.TARO_APP_API_BASE || 'http://127.0.0.1:8080/api/v1'

export async function api(path, options = {}) {
  const token = Taro.getStorageSync('health_token')
  const response = await Taro.request({
    url: `${API_BASE}${path}`,
    method: options.method || 'GET',
    data: options.data,
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.header || {})
    }
  })
  const payload = response.data
  if (response.statusCode >= 400 || payload?.code !== 0) {
    if (response.statusCode === 401) {
      Taro.removeStorageSync('health_token')
    }
    throw new Error(payload?.message || '请求失败')
  }
  return payload.data
}

export function ensureLogin() {
  if (!Taro.getStorageSync('health_token')) {
    Taro.reLaunch({ url: '/pages/login/index' })
    return false
  }
  return true
}

export { API_BASE }
