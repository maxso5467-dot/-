import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Text, View } from '@tarojs/components'
import { api } from '../../utils/api'

export default function LoginPage() {
  const [username, setUsername] = useState('zhangsan')
  const [password, setPassword] = useState('123456')
  const [loading, setLoading] = useState(false)

  async function login() {
    setLoading(true)
    try {
      const data = await api('/auth/login', { method: 'POST', data: { username, password } })
      Taro.setStorageSync('health_token', data.accessToken)
      Taro.setStorageSync('health_user', data.user)
      Taro.switchTab({ url: '/pages/home/index' })
    } catch (error) {
      Taro.showToast({ title: error.message, icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  async function wechatLogin() {
    setLoading(true)
    try {
      const loginResult = await Taro.login()
      const data = await api('/auth/wechat/login', { method: 'POST', data: { code: loginResult.code } })
      Taro.setStorageSync('health_token', data.accessToken)
      Taro.setStorageSync('health_user', data.user)
      Taro.switchTab({ url: '/pages/home/index' })
    } catch (error) {
      Taro.showToast({ title: error.message, icon: 'none', duration: 3000 })
    } finally {
      setLoading(false)
    }
  }

  return <View className='page login-page'>
    <View className='brand'>XuenWu Health</View>
    <View className='title'>随时问，安心看</View>
    <Text className='subtitle'>结构化症状整理、连续追问、风险提示与就医建议。</Text>
    <View className='panel login-panel'>
      <View className='field'><Text className='field-label'>用户名</Text><Input className='input' value={username} onInput={(event) => setUsername(event.detail.value)} /></View>
      <View className='field'><Text className='field-label'>密码</Text><Input className='input' password value={password} onInput={(event) => setPassword(event.detail.value)} /></View>
      <Button className='primary-button' loading={loading} onClick={login}>登录</Button>
      <Button className='secondary-button' loading={loading} onClick={wechatLogin}>微信快捷登录</Button>
      <Text className='muted login-hint'>开发测试账号：zhangsan / 123456</Text>
    </View>
  </View>
}
