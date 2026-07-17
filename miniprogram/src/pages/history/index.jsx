import { useState } from 'react'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { api, ensureLogin } from '../../utils/api'

export default function HistoryPage() {
  const [sessions, setSessions] = useState([])

  async function load() {
    if (!ensureLogin()) return
    try { setSessions((await api('/consultations?page=1&pageSize=30')).items || []) }
    catch (error) { Taro.showToast({ title: error.message, icon: 'none' }) }
    finally { Taro.stopPullDownRefresh() }
  }

  useDidShow(() => { load() })
  usePullDownRefresh(() => { load() })

  return <View className='page'>
    <View className='title'>问诊历史</View><Text className='subtitle'>下拉可刷新最近问诊记录。</Text>
    <View className='history-list'>
      {sessions.map((item) => <View className='panel history-item' key={item.id}>
        <View className='history-head'><Text className='history-title'>{item.title}</Text><Text className={`risk-${item.riskLevel}`}>{item.riskLevel}</Text></View>
        <Text className='department'>{item.recommendedDepartment || '待分诊'}</Text>
        <Text className='muted'>{item.summary || '尚未生成问诊摘要'}</Text>
      </View>)}
      {!sessions.length && <View className='panel muted'>暂无问诊记录</View>}
    </View>
  </View>
}
