import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import { api, ensureLogin } from '../../utils/api'

const genders = ['unknown', 'male', 'female', 'other']
const genderLabels = ['未设置', '男', '女', '其他']

export default function ProfilePage() {
  const [profile, setProfile] = useState({ gender: 'unknown' })
  const [saving, setSaving] = useState(false)

  useDidShow(async () => {
    if (!ensureLogin()) return
    try { setProfile((await api('/health-profile/me')) || { gender: 'unknown' }) }
    catch (error) { Taro.showToast({ title: error.message, icon: 'none' }) }
  })

  function update(key, value) { setProfile({ ...profile, [key]: value }) }

  async function save() {
    setSaving(true)
    try {
      await api('/health-profile/me', { method: 'PUT', data: profile })
      Taro.showToast({ title: '档案已保存', icon: 'success' })
    } catch (error) { Taro.showToast({ title: error.message, icon: 'none' }) }
    finally { setSaving(false) }
  }

  return <View className='page'>
    <View className='title'>健康档案</View><Text className='subtitle'>完整档案能帮助AI减少重复追问，但不会替代医生判断。</Text>
    <View className='panel profile-form'>
      <View className='field'><Text className='field-label'>性别</Text><Picker mode='selector' range={genderLabels} value={Math.max(0, genders.indexOf(profile.gender))} onChange={(event) => update('gender', genders[Number(event.detail.value)])}><View className='picker'>{genderLabels[Math.max(0, genders.indexOf(profile.gender))]}</View></Picker></View>
      <View className='field'><Text className='field-label'>出生日期</Text><Picker mode='date' value={String(profile.birthDate || '1990-01-01').slice(0, 10)} onChange={(event) => update('birthDate', event.detail.value)}><View className='picker'>{String(profile.birthDate || '请选择').slice(0, 10)}</View></Picker></View>
      <View className='field'><Text className='field-label'>身高 cm</Text><Input className='input' type='digit' value={String(profile.heightCm || '')} onInput={(event) => update('heightCm', Number(event.detail.value))} /></View>
      <View className='field'><Text className='field-label'>体重 kg</Text><Input className='input' type='digit' value={String(profile.weightKg || '')} onInput={(event) => update('weightKg', Number(event.detail.value))} /></View>
      <View className='field'><Text className='field-label'>过敏史</Text><Textarea className='textarea small' value={profile.allergyHistory || ''} onInput={(event) => update('allergyHistory', event.detail.value)} /></View>
      <View className='field'><Text className='field-label'>既往病史</Text><Textarea className='textarea small' value={profile.diseaseHistory || ''} onInput={(event) => update('diseaseHistory', event.detail.value)} /></View>
      <View className='field'><Text className='field-label'>当前用药</Text><Textarea className='textarea small' value={profile.currentMedications || ''} onInput={(event) => update('currentMedications', event.detail.value)} /></View>
      <Button className='primary-button' loading={saving} onClick={save}>保存档案</Button>
    </View>
  </View>
}
