function request(path, options = {}) {
  const token = wx.getStorageSync('health_token')
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApp().globalData.apiBase}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      success(response) {
        const payload = response.data || {}
        if (response.statusCode >= 400 || payload.code !== 0) {
          reject(new Error(payload.message || '请求失败'))
          return
        }
        resolve(payload.data)
      },
      fail: () => reject(new Error('无法连接本地服务，请确认后端已启动'))
    })
  })
}

module.exports = { request }
