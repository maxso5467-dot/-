import { useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { api, ensureLogin } from '../../utils/api'

export default function HomePage() {
  const [user, setUser] = useState(Taro.getStorageSync('health_user') || {})
  const [profile, setProfile] = useState(null)
  const [sessions, setSessions] = useState([])
  const [ai, setAi] = useState(null)

  async function load() {
    if (!ensureLogin()) return
    try {
      const [me, profileData, sessionData, aiData] = await Promise.all([
        api('/auth/me'), api('/health-profile/me'), api('/consultations?page=1&pageSize=3'), api('/ai/status')
      ])
      setUser(me); setProfile(profileData); setSessions(sessionData.items || []); setAi(aiData)
      Taro.setStorageSync('health_user', me)
    } catch (error) { Taro.showToast({ title: error.message, icon: 'none' }) }
  }

  useEffect(() => { load() }, [])
  useDidShow(() => { load() })

  return <View className='page'>
    <View className='brand'>XuenWu Health</View>
    <View className='title'>{user.displayName || '你好'}，今天感觉怎么样？</View>
    <View className='status-strip'>
      <View><Text className='status-value'>{ai?.realAiEnabled ? '在线' : '降级'}</Text><Text className='status-label'>AI服务</Text></View>
      <View><Text className='status-value'>{profile?.weightKg || '--'}</Text><Text className='status-label'>体重 kg</Text></View>
      <View><Text className='status-value'>{sessions.length}</Text><Text className='status-label'>近期问诊</Text></View>
    </View>
    <View className='panel action-panel' onClick={() => Taro.switchTab({ url: '/pages/consultation/index' })}>
      <Text className='action-title'>开始智能问诊</Text><Text className='muted'>文字描述或使用症状自查，AI会继续追问关键信息。</Text>
    </View>
    <View className='panel'>
      <View className='panel-title'>近期问诊</View>
      {sessions.length ? sessions.map((item) => <View className='session-row' key={item.id}>
        <View><Text className='session-title'>{item.title}</Text><Text className='muted'>{item.recommendedDepartment || '待分诊'}</Text></View>
        <Text className={`risk-${item.riskLevel}`}>{item.riskLevel}</Text>
      </View>) : <Text className='muted'>暂无问诊记录</Text>}
    </View>
    <Button className='secondary-button' onClick={() => { Taro.clearStorageSync(); Taro.reLaunch({ url: '/pages/login/index' }) }}>退出登录</Button>
  </View>
}
