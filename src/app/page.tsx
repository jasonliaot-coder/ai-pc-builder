'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'

const AI_API_KEY = process.env.NEXT_PUBLIC_AI_API_KEY || ''
const AI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const APIFY_TOKEN = process.env.NEXT_PUBLIC_APIFY_TOKEN || ''
const APIFY_ENDPOINT = 'https://api.apify.com/v2/acts/matyascimbulka~pcpartpicker-scraper/run-sync-get-dataset-items'

const apifyCategoryMap: Record<string, string> = {
  'CPU': 'cpu', 'Motherboard': 'motherboard', 'Memory': 'memory', 'Memory (RAM)': 'memory',
  'Storage': 'storage', 'Video Card (GPU)': 'video-card', 'GPU': 'video-card',
  'Power Supply': 'power-supply', 'Case': 'case', 'CPU Cooler': 'cpu-cooler',
  'Monitor': 'monitor', 'Keyboard': 'keyboard', 'Mouse': 'mouse', 'Headphones': 'headphones'
}

interface RealPriceData { price: number; url: string; merchant: string; lowestPrice: number }
interface BuildComponent { category: string; name: string; price: number; reason: string }
interface Build { components: BuildComponent[]; totalPrice: number; summary: string }
interface Settings {
  cpuBrand: string; cpuSeries: string; gpuBrand: string; gpuSeries: string; gpuAIB: string;
  mbBrand: string; ramBrand: string; ramType: string; storageBrand: string;
  psuBrand: string; caseBrand: string; coolerBrand: string;
  monitorBrand: string; keyboardBrand: string; mouseBrand: string; headphoneBrand: string
}

const defaultSettings: Settings = {
  cpuBrand: 'any', cpuSeries: 'any', gpuBrand: 'any', gpuSeries: 'any', gpuAIB: 'any',
  mbBrand: 'any', ramBrand: 'any', ramType: 'any', storageBrand: 'any',
  psuBrand: 'any', caseBrand: 'any', coolerBrand: 'any',
  monitorBrand: 'any', keyboardBrand: 'any', mouseBrand: 'any', headphoneBrand: 'any'
}

function extractBuildFromResponse(content: string): Build {
  try { return JSON.parse(content) }
  catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])
    throw new Error('Failed to parse AI response')
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...options, signal: controller.signal }) }
  finally { clearTimeout(timeout) }
}

async function fetchSinglePrice(component: BuildComponent, index: number): Promise<{ index: number; data: RealPriceData | null }> {
  const apifyCategory = apifyCategoryMap[component.category] || 'cpu'
  try {
    const response = await fetchWithTimeout(`${APIFY_ENDPOINT}?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: apifyCategory, searchPhrases: [component.name], maxProducts: 1, maxReviews: 0, countryCode: 'us' })
    }, 45000)
    if (!response.ok) return { index, data: null }
    const items = await response.json()
    if (items && items.length > 0 && items[0].prices?.lowestPrice != null) {
      return { index, data: { price: items[0].prices.lowestPrice, url: items[0].url || '', merchant: items[0].prices.prices?.[0]?.merchant || 'PCPartPicker', lowestPrice: items[0].prices.lowestPrice } }
    }
    return { index, data: null }
  } catch { return { index, data: null } }
}

export default function Home() {
  const { user, signOut } = useAuth()
  const [budget, setBudget] = useState(1000)
  const [purpose, setPurpose] = useState('gaming')
  const [notes, setNotes] = useState('')
  const [components, setComponents] = useState({ cpu: true, motherboard: true, memory: true, storage: true, gpu: true, psu: true, case: true, cooler: true, monitor: false, keyboard: false, mouse: false, headphones: false })
  const [settings, setSettings] = useState(defaultSettings)
  const [isGenerating, setIsGenerating] = useState(false)
  const [build, setBuild] = useState<Build | null>(null)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [realPrices, setRealPrices] = useState<Record<number, RealPriceData>>({})
  const [fetchingPrices, setFetchingPrices] = useState(false)
  const [priceProgress, setPriceProgress] = useState(0)
  const [priceTotal, setPriceTotal] = useState(0)
  const [ramAmount, setRamAmount] = useState('32GB')
  const [storageType, setStorageType] = useState('Gen4 NVMe M.2 SSD')
  const [storageSize, setStorageSize] = useState('1TB')
  const [targetResolution, setTargetResolution] = useState('1440p')
  const [targetFPS, setTargetFPS] = useState('144')
  const [formFactor, setFormFactor] = useState('ATX')
  const [aesthetic, setAesthetic] = useState('any')
  const [noisePreference, setNoisePreference] = useState('balanced')
  const [specificGames, setSpecificGames] = useState('')
  const [specificSoftware, setSpecificSoftware] = useState('')

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('pcBuildSettings')
    if (saved) {
      try { setSettings(prev => ({ ...prev, ...JSON.parse(saved) })) } catch {}
    }
  }, [])

  const toggleComponent = useCallback((key: keyof typeof components) => {
    setComponents(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const getSettingsPrompt = useCallback(() => {
    const s = settings
    const items = [
      s.cpuBrand !== 'any' && `CPU brand: ${s.cpuBrand}`,
      s.cpuSeries !== 'any' && `CPU series: ${s.cpuSeries}`,
      s.gpuBrand !== 'any' && `GPU brand: ${s.gpuBrand}`,
      s.gpuSeries !== 'any' && `GPU series: ${s.gpuSeries}`,
      s.gpuAIB !== 'any' && `GPU manufacturer: ${s.gpuAIB}`,
      s.mbBrand !== 'any' && `Motherboard brand: ${s.mbBrand}`,
      s.ramBrand !== 'any' && `RAM brand: ${s.ramBrand}`,
      s.ramType !== 'any' && `RAM type: ${s.ramType}`,
      s.storageBrand !== 'any' && `Storage brand: ${s.storageBrand}`,
      s.psuBrand !== 'any' && `PSU brand: ${s.psuBrand}`,
      s.caseBrand !== 'any' && `Case brand: ${s.caseBrand}`,
      s.coolerBrand !== 'any' && `CPU cooler brand: ${s.coolerBrand}`,
      s.monitorBrand !== 'any' && `Monitor brand: ${s.monitorBrand}`,
      s.keyboardBrand !== 'any' && `Keyboard brand: ${s.keyboardBrand}`,
      s.mouseBrand !== 'any' && `Mouse brand: ${s.mouseBrand}`,
      s.headphoneBrand !== 'any' && `Headphone brand: ${s.headphoneBrand}`
    ].filter(Boolean)
    return items.length > 0 ? `\n- Brand preferences: ${items.join(', ')}` : ''
  }, [settings])

  const getSpecificsPrompt = useCallback(() => {
    const items = [
      `RAM: ${ramAmount} ${settings.ramType !== 'any' ? settings.ramType : 'DDR5'}`,
      `Storage: ${storageSize} ${storageType}`,
      `Target: ${targetResolution} at ${targetFPS} FPS`,
      `Form factor: ${formFactor}`,
      aesthetic !== 'any' && `Aesthetic: ${aesthetic}`,
      noisePreference !== 'balanced' && `Noise: ${noisePreference}`,
      specificGames.trim() && `Target games: ${specificGames}`,
      specificSoftware.trim() && `Target software: ${specificSoftware}`
    ].filter(Boolean)
    return `\n\nSpecific requirements:\n- ${items.join('\n- ')}`
  }, [ramAmount, storageType, storageSize, targetResolution, targetFPS, formFactor, aesthetic, noisePreference, specificGames, specificSoftware, settings.ramType])

  const fetchRealPrices = useCallback(async (buildToFetch: Build) => {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    setFetchingPrices(true)
    setPriceTotal(buildToFetch.components.length)
    setPriceProgress(0)
    setRealPrices({})

    const results = await Promise.allSettled(
      buildToFetch.components.map((comp, i) =>
        fetchSinglePrice(comp, i).then(result => { setPriceProgress(prev => prev + 1); return result })
      )
    )

    const newPrices: Record<number, RealPriceData> = {}
    results.forEach(r => { if (r.status === 'fulfilled' && r.value.data) { newPrices[r.value.index] = r.value.data } })
    setRealPrices(newPrices)
    setFetchingPrices(false)
    abortRef.current = null
  }, [])

  const generateBuild = useCallback(async () => {
    const selectedComponents = [
      components.cpu && 'CPU', components.motherboard && 'Motherboard',
      components.memory && 'Memory (RAM)', components.storage && 'Storage',
      components.gpu && 'Video Card (GPU)', components.psu && 'Power Supply',
      components.case && 'Case', components.cooler && 'CPU Cooler',
      components.monitor && 'Monitor', components.keyboard && 'Keyboard',
      components.mouse && 'Mouse', components.headphones && 'Headphones'
    ].filter(Boolean) as string[]

    if (selectedComponents.length === 0) { setError('Please select at least one component to include.'); return }

    setError('')
    setBuild(null)
    setRealPrices({})
    setIsGenerating(true)

    const promptLines = [
      `Create a PC build with a budget of $${budget} for ${purpose}.`,
      '',
      `Components to include: ${selectedComponents.join(', ')}${getSpecificsPrompt()}${getSettingsPrompt()}`,
      notes ? `\nAdditional notes: ${notes}` : '',
      '',
      'For each component, provide:',
      '- category: the component type',
      '- name: the specific product name (include model numbers)',
      '- price: estimated price in USD',
      '- reason: brief explanation of why this part was chosen for this specific build',
      '',
      'Return ONLY a valid JSON object with this structure:',
      '{',
      '  "components": [',
      '    {',
      '      "category": "CPU",',
      '      "name": "AMD Ryzen 7 7800X3D",',
      '      "price": 369,',
      '      "reason": "Best gaming CPU for 1440p 144fps targets"',
      '    }',
      '  ],',
      '  "totalPrice": 1000,',
      '  "summary": "Brief summary of the build and why it fits the requirements"',
      '}'
    ].join('\n')

    try {
      const response = await fetch(AI_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: 'You are a PC building expert. Create optimal, specific builds within budget constraints. Include exact model numbers. Return only valid JSON.' }, { role: 'user', content: promptLines }],
          temperature: 0.7
        })
      })
      if (!response.ok) { const errText = await response.text(); throw new Error(`API error (${response.status}): ${errText}`) }
      const data = await response.json()
      const buildResult = extractBuildFromResponse(data.choices[0].message.content)
      setBuild(buildResult)
      await fetchRealPrices(buildResult)
    } catch (err: any) {
      if (err.name !== 'AbortError') { setError(`Failed to generate build: ${err.message}`) }
    } finally {
      setIsGenerating(false)
    }
  }, [budget, purpose, notes, components, getSettingsPrompt, getSpecificsPrompt, fetchRealPrices])

  const saveSettings = useCallback(() => {
    localStorage.setItem('pcBuildSettings', JSON.stringify(settings))
    setShowSettings(false)
  }, [settings])

  const resetSettings = useCallback(() => { setSettings(defaultSettings) }, [])

  const hasRealPrices = Object.keys(realPrices).length > 0
  const realTotal = hasRealPrices ? Object.values(realPrices).reduce((sum: number, data: RealPriceData) => sum + data.price, 0) : 0
  const aiTotal = build ? (build.totalPrice || build.components.reduce((sum: number, c: BuildComponent) => sum + c.price, 0)) : 0

  return (
    <div className="build-container">
      <div className="build-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: user ? '16px' : '0' }}>
          {user && (
            <div className="user-menu">
              <span className="user-email">{user.email}</span>
              <button className="btn-signout" onClick={signOut}>Sign Out</button>
            </div>
          )}
        </div>
        <h1 className="build-title">AI PC Build Generator</h1>
        <p className="build-subtitle">Let our AI create the perfect build for your budget and needs.</p>
      </div>

      <div className="build-form-card">
        <div className="form-header">
          <h2 className="form-title">Build Configuration</h2>
          <button className="btn-settings" onClick={() => setShowSettings(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span>Brand Settings</span>
          </button>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="buildBudget">Budget</label>
            <div className="input-with-prefix">
              <span className="input-prefix">$</span>
              <input type="number" id="buildBudget" placeholder="1000" min="100" max="10000" value={budget} onChange={(e) => setBudget(parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="buildPurpose">Primary Use</label>
            <select id="buildPurpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              <option value="gaming">Gaming</option>
              <option value="competitive-gaming">Competitive Gaming (Esports)</option>
              <option value="casual-gaming">Casual Gaming</option>
              <option value="retro-gaming">Retro Gaming / Emulation</option>
              <option value="vr-gaming">VR Gaming</option>
              <option value="productivity">Productivity / Work</option>
              <option value="streaming">Streaming</option>
              <option value="video-editing">Video Editing</option>
              <option value="3d-rendering">3D Rendering</option>
              <option value="music-production">Music Production</option>
              <option value="photo-editing">Photo Editing</option>
              <option value="coding">Coding / Development</option>
              <option value="data-science">Data Science / ML</option>
              <option value="general">General Use</option>
              <option value="budget">Budget Build</option>
              <option value="high-end">High-End Performance</option>
              <option value="workstation">Workstation</option>
              <option value="home-theater">Home Theater PC</option>
              <option value="nas">NAS / Home Server</option>
              <option value="htpc">HTPC (Living Room PC)</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="targetResolution">Target Resolution</label>
            <select id="targetResolution" value={targetResolution} onChange={(e) => setTargetResolution(e.target.value)}>
              <option value="720p">720p (HD)</option>
              <option value="1080p">1080p (Full HD)</option>
              <option value="1440p">1440p (2K / QHD)</option>
              <option value="4K">4K (2160p / UHD)</option>
              <option value="5K">5K (5120x2880)</option>
              <option value="8K">8K (4320p)</option>
              <option value="ultrawide-1080p">Ultrawide 1080p (2560x1080)</option>
              <option value="ultrawide">Ultrawide 1440p (3440x1440)</option>
              <option value="ultrawide-4K">Ultrawide 4K (3840x1600)</option>
              <option value="super-ultrawide">Super Ultrawide (5120x1440)</option>
              <option value="dual-monitor">Dual Monitor Setup</option>
              <option value="triple-monitor">Triple Monitor Setup</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="targetFPS">Target FPS</label>
            <select id="targetFPS" value={targetFPS} onChange={(e) => setTargetFPS(e.target.value)}>
              <option value="30">30 FPS</option>
              <option value="60">60 FPS</option>
              <option value="75">75 FPS</option>
              <option value="90">90 FPS</option>
              <option value="100">100 FPS</option>
              <option value="120">120 FPS</option>
              <option value="144">144 FPS</option>
              <option value="165">165 FPS</option>
              <option value="180">180 FPS</option>
              <option value="200">200 FPS</option>
              <option value="240">240 FPS</option>
              <option value="280">280 FPS</option>
              <option value="300">300 FPS</option>
              <option value="360">360 FPS</option>
              <option value="480">480 FPS</option>
              <option value="500+">500+ FPS (Maximum)</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="ramAmount">RAM Amount</label>
            <select id="ramAmount" value={ramAmount} onChange={(e) => setRamAmount(e.target.value)}>
              <option value="8GB">8GB (Basic)</option>
              <option value="16GB">16GB (Standard)</option>
              <option value="32GB">32GB (Recommended)</option>
              <option value="48GB">48GB (Enthusiast)</option>
              <option value="64GB">64GB (Professional)</option>
              <option value="96GB">96GB (Workstation)</option>
              <option value="128GB">128GB (Server/ML)</option>
              <option value="192GB">192GB (Extreme)</option>
              <option value="256GB">256GB (Maximum)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="storageType">Storage Type & Setup</label>
            <select id="storageType" value={storageType} onChange={(e) => setStorageType(e.target.value)}>
              <option value="Gen5 NVMe M.2 SSD">Gen5 NVMe M.2 SSD (Cutting-edge, 10000+ MB/s)</option>
              <option value="Gen4 NVMe M.2 SSD">Gen4 NVMe M.2 SSD (High-End, 7000 MB/s)</option>
              <option value="Gen3 NVMe M.2 SSD">Gen3 NVMe M.2 SSD (Standard, 3500 MB/s)</option>
              <option value="Gen2 NVMe M.2 SSD">Gen2 NVMe M.2 SSD (Budget, 2000 MB/s)</option>
              <option value="2.5-inch SATA SSD">2.5" SATA SSD (550 MB/s)</option>
              <option value="M.2 SATA SSD">M.2 SATA SSD (550 MB/s, compact)</option>
              <option value="3.5-inch HDD 7200RPM">3.5" HDD 7200RPM (Fast Mechanical)</option>
              <option value="3.5-inch HDD 5400RPM">3.5" HDD 5400RPM (Quiet/Bulk)</option>
              <option value="2.5-inch HDD">2.5" HDD (Laptop/Compact)</option>
              <option value="NVMe Boot + HDD Storage">Combo: NVMe (OS) + HDD (Bulk Storage)</option>
              <option value="NVMe Boot + SATA SSD Storage">Combo: NVMe (OS) + SATA SSD (Games)</option>
              <option value="Dual NVMe Setup">Dual NVMe Setup (OS + Games)</option>
              <option value="Triple NVMe Setup">Triple NVMe Setup (OS + Games + Storage)</option>
              <option value="NVMe + HDD + SSD">Triple: NVMe (OS) + SSD (Games) + HDD (Bulk)</option>
              <option value="All NVMe">All NVMe (Maximum Performance)</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="storageSize">Storage Capacity</label>
            <select id="storageSize" value={storageSize} onChange={(e) => setStorageSize(e.target.value)}>
              <option value="128GB">128GB</option>
              <option value="250GB">250GB</option>
              <option value="500GB">500GB</option>
              <option value="750GB">750GB</option>
              <option value="1TB">1TB</option>
              <option value="2TB">2TB</option>
              <option value="4TB">4TB</option>
              <option value="6TB">6TB</option>
              <option value="8TB">8TB</option>
              <option value="10TB">10TB</option>
              <option value="12TB">12TB</option>
              <option value="16TB">16TB</option>
              <option value="18TB">18TB</option>
              <option value="20TB">20TB</option>
              <option value="22TB">22TB</option>
              <option value="24TB+">24TB+ (Massive)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="formFactor">Form Factor</label>
            <select id="formFactor" value={formFactor} onChange={(e) => setFormFactor(e.target.value)}>
              <option value="E-ATX">E-ATX (Extended - Enthusiast)</option>
              <option value="ATX">ATX (Standard Full-Size)</option>
              <option value="mATX">Micro-ATX (Compact)</option>
              <option value="Mini-ITX">Mini-ITX (Ultra Compact)</option>
              <option value="XL-ATX">XL-ATX (Extra Large)</option>
              <option value="SSI-EEB">SSI-EEB (Server/Workstation)</option>
              <option value="SSI-CEB">SSI-CEB (Compact Server)</option>
              <option value="DTX">DTX (Small Form Factor)</option>
              <option value="Mini-DTX">Mini-DTX (Ultra Small)</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="aesthetic">Aesthetic</label>
            <select id="aesthetic" value={aesthetic} onChange={(e) => setAesthetic(e.target.value)}>
              <option value="any">No Preference</option>
              <option value="rgb">Full RGB Lighting</option>
              <option value="argb">ARGB (Addressable RGB)</option>
              <option value="no-rgb">No RGB (Clean/Professional)</option>
              <option value="white">All White Build</option>
              <option value="black">All Black Build</option>
              <option value="silver">Silver/Grey Theme</option>
              <option value="red">Red Accent Theme</option>
              <option value="blue">Blue Accent Theme</option>
              <option value="green">Green Accent Theme</option>
              <option value="purple">Purple Accent Theme</option>
              <option value="gold">Gold Accent Theme</option>
              <option value="minimal">Minimal / Stealth</option>
              <option value="cyberpunk">Cyberpunk / Futuristic</option>
              <option value="retro">Retro / Vintage</option>
              <option value="industrial">Industrial / Utilitarian</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="noisePreference">Noise Level</label>
            <select id="noisePreference" value={noisePreference} onChange={(e) => setNoisePreference(e.target.value)}>
              <option value="silent">Completely Silent (Fanless where possible)</option>
              <option value="very-quiet">Very Quiet (&lt; 20 dB)</option>
              <option value="quiet">Quiet (20-30 dB)</option>
              <option value="balanced">Balanced (30-40 dB)</option>
              <option value="moderate">Moderate (40-50 dB)</option>
              <option value="performance">Performance First (50+ dB OK)</option>
              <option value="maximum-cooling">Maximum Cooling (Noise doesn&apos;t matter)</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Components to Include</label>
          <div className="component-checkboxes">
            {[
              { key: 'cpu', label: 'CPU' }, { key: 'motherboard', label: 'Motherboard' },
              { key: 'memory', label: 'Memory' }, { key: 'storage', label: 'Storage' },
              { key: 'gpu', label: 'GPU' }, { key: 'psu', label: 'Power Supply' },
              { key: 'case', label: 'Case' }, { key: 'cooler', label: 'CPU Cooler' },
              { key: 'monitor', label: 'Monitor' }, { key: 'keyboard', label: 'Keyboard' },
              { key: 'mouse', label: 'Mouse' }, { key: 'headphones', label: 'Headphones' }
            ].map(({ key, label }) => (
              <label key={key} className={`checkbox-label ${components[key as keyof typeof components] ? 'active' : ''}`}>
                <input type="checkbox" checked={components[key as keyof typeof components]} onChange={() => toggleComponent(key as keyof typeof components)} />
                <div className="checkbox-indicator"></div>
                <span className="checkbox-text">{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="specificGames">Target Games <span className="label-optional">(Optional)</span></label>
          <input type="text" id="specificGames" placeholder="e.g., Cyberpunk 2077, Fortnite, Valorant, Elden Ring" value={specificGames} onChange={(e) => setSpecificGames(e.target.value)} className="text-input" />
        </div>
        <div className="form-group">
          <label htmlFor="specificSoftware">Target Software <span className="label-optional">(Optional)</span></label>
          <input type="text" id="specificSoftware" placeholder="e.g., Blender, Adobe Premiere, OBS, Ableton Live" value={specificSoftware} onChange={(e) => setSpecificSoftware(e.target.value)} className="text-input" />
        </div>
        <div className="form-group">
          <label htmlFor="buildNotes">Additional Notes <span className="label-optional">(Optional)</span></label>
          <textarea id="buildNotes" placeholder="e.g., Prefer AMD over Intel, need WiFi, want specific color scheme..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button className="btn-generate" onClick={generateBuild} disabled={isGenerating}>
          <svg className="btn-sparkle" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l1.912 5.813L20 10l-6.088 1.187L12 17l-1.912-5.813L4 10l6.088-1.187L12 3z"/>
          </svg>
          <span>{isGenerating ? 'Generating...' : 'Generate Build'}</span>
        </button>
      </div>

      {isGenerating && (
        <div className="ai-build-loading">
          <div className="loading-animation">
            <div className="loading-ring"></div>
            <div className="loading-ring"></div>
            <div className="loading-ring"></div>
          </div>
          <p className="loading-text">Designing your perfect build...</p>
        </div>
      )}

      {fetchingPrices && !isGenerating && (
        <div className="ai-build-loading">
          <div className="loading-animation">
            <div className="loading-ring"></div>
            <div className="loading-ring"></div>
            <div className="loading-ring"></div>
          </div>
          <p className="loading-text">Fetching real prices from PCPartPicker...</p>
          <p className="loading-subtext">{priceProgress} of {priceTotal} components checked</p>
        </div>
      )}

      {build && (
        <div className="ai-build-result">
          <div className="build-summary">
            <div className="build-summary-header">
              <h3>Your Custom PC Build</h3>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {hasRealPrices && <span style={{ fontSize: '13px', color: 'var(--success)' }}>✓ Real prices loaded</span>}
                <button className="btn-regenerate" onClick={generateBuild}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  Regenerate
                </button>
              </div>
            </div>
            <div id="buildContent">
              {build.components.map((component, index) => {
                const realData = realPrices[index]
                return (
                  <div key={index} className="build-component">
                    <div className="component-info">
                      <div className="component-category">{component.category}</div>
                      <div className="component-name">
                        {realData?.url ? (
                          <a href={realData.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--neon-blue)', textDecoration: 'none' }}>{component.name}</a>
                        ) : component.name}
                      </div>
                      {component.reason && <div className="component-reason">{component.reason}</div>}
                      {realData && <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>Lowest at: {realData.merchant}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      {realData ? (
                        <>
                          <div className="component-price">${realData.price.toFixed(2)}</div>
                          {component.price !== realData.price && <div style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'line-through' }}>AI est: ${component.price}</div>}
                        </>
                      ) : <div className="component-price" style={{ opacity: 0.7 }}>${component.price}</div>}
                    </div>
                  </div>
                )
              })}
              <div className="build-total">
                <div className="build-total-label">{hasRealPrices ? 'Real Total Cost' : 'Estimated Total Cost'}</div>
                <div className="build-total-price">${hasRealPrices ? realTotal.toFixed(2) : aiTotal}</div>
              </div>
              {build.summary && <div className="build-notes">{build.summary}</div>}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{error}</span>
        </div>
      )}

      {showSettings && (
        <div className="modal">
          <div className="modal-backdrop" onClick={() => setShowSettings(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Brand & Series Preferences</h2>
              <button className="btn-close" onClick={() => setShowSettings(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-section">
                <h3>CPU Preferences</h3>
                <div className="setting-group">
                  <label htmlFor="cpuBrand">Brand</label>
                  <select id="cpuBrand" value={settings.cpuBrand} onChange={(e) => setSettings({ ...settings, cpuBrand: e.target.value, cpuSeries: 'any' })}>
                    <option value="any">Any</option>
                    <option value="AMD">AMD</option>
                    <option value="Intel">Intel</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="cpuSeries">Series</label>
                  <select id="cpuSeries" value={settings.cpuSeries} onChange={(e) => setSettings({ ...settings, cpuSeries: e.target.value })} disabled={settings.cpuBrand === 'any'}>
                    <option value="any">Any</option>
                    {settings.cpuBrand === 'AMD' && <optgroup label="AMD">
                      <option value="Ryzen 9">Ryzen 9 (Flagship)</option>
                      <option value="Ryzen 7">Ryzen 7 (Performance)</option>
                      <option value="Ryzen 5">Ryzen 5 (Mainstream)</option>
                      <option value="Ryzen 3">Ryzen 3 (Budget)</option>
                      <option value="Threadripper">Threadripper (HEDT)</option>
                      <option value="Athlon">Athlon (Ultra Budget)</option>
                      <option value="EPYC">EPYC (Server)</option>
                    </optgroup>}
                    {settings.cpuBrand === 'Intel' && <optgroup label="Intel">
                      <option value="Core Ultra 9">Core Ultra 9 (Flagship)</option>
                      <option value="Core Ultra 7">Core Ultra 7 (High-End)</option>
                      <option value="Core Ultra 5">Core Ultra 5 (Mainstream)</option>
                      <option value="Core i9">Core i9 (High-End)</option>
                      <option value="Core i7">Core i7 (Performance)</option>
                      <option value="Core i5">Core i5 (Mainstream)</option>
                      <option value="Core i3">Core i3 (Budget)</option>
                      <option value="Pentium">Pentium (Entry)</option>
                      <option value="Celeron">Celeron (Ultra Budget)</option>
                      <option value="Xeon">Xeon (Server)</option>
                    </optgroup>}
                  </select>
                </div>
              </div>
              <div className="settings-section">
                <h3>GPU Preferences</h3>
                <div className="setting-group">
                  <label htmlFor="gpuBrand">Brand</label>
                  <select id="gpuBrand" value={settings.gpuBrand} onChange={(e) => setSettings({ ...settings, gpuBrand: e.target.value, gpuSeries: 'any' })}>
                    <option value="any">Any</option>
                    <option value="NVIDIA">NVIDIA</option>
                    <option value="AMD">AMD</option>
                    <option value="Intel">Intel</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="gpuSeries">Series</label>
                  <select id="gpuSeries" value={settings.gpuSeries} onChange={(e) => setSettings({ ...settings, gpuSeries: e.target.value })} disabled={settings.gpuBrand === 'any'}>
                    <option value="any">Any</option>
                    {settings.gpuBrand === 'NVIDIA' && <optgroup label="NVIDIA">
                      <option value="RTX 5000">RTX 5000 Series (Blackwell)</option>
                      <option value="RTX 4000">RTX 4000 Series (Ada)</option>
                      <option value="RTX 3000">RTX 3000 Series (Ampere)</option>
                      <option value="RTX 2000">RTX 2000 Series (Turing)</option>
                      <option value="GTX 1600">GTX 1600 Series (Turing)</option>
                      <option value="GTX 1000">GTX 1000 Series (Pascal)</option>
                      <option value="GTX 900">GTX 900 Series (Maxwell)</option>
                      <option value="Titan">Titan Series</option>
                      <option value="Quadro">Quadro (Professional)</option>
                    </optgroup>}
                    {settings.gpuBrand === 'AMD' && <optgroup label="AMD">
                      <option value="RX 9000">RX 9000 Series (RDNA 4)</option>
                      <option value="RX 7000">RX 7000 Series (RDNA 3)</option>
                      <option value="RX 6000">RX 6000 Series (RDNA 2)</option>
                      <option value="RX 5000">RX 5000 Series (RDNA 1)</option>
                      <option value="RX 500">RX 500 Series (Polaris)</option>
                      <option value="RX Vega">RX Vega Series</option>
                      <option value="Radeon Pro">Radeon Pro (Professional)</option>
                    </optgroup>}
                    {settings.gpuBrand === 'Intel' && <optgroup label="Intel">
                      <option value="Arc B">Arc B Series (Battlemage)</option>
                      <option value="Arc A">Arc A Series (Alchemist)</option>
                      <option value="Iris Xe">Iris Xe (Integrated)</option>
                      <option value="UHD Graphics">UHD Graphics (Integrated)</option>
                    </optgroup>}
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="gpuAIB">Manufacturer</label>
                  <select id="gpuAIB" value={settings.gpuAIB} onChange={(e) => setSettings({ ...settings, gpuAIB: e.target.value })} disabled={settings.gpuBrand === 'any'}>
                    <option value="any">Any</option>
                    {(!settings.gpuBrand || settings.gpuBrand === 'any' || settings.gpuBrand === 'NVIDIA') && <>
                      <option value="ASUS">ASUS (ROG/TUF)</option>
                      <option value="MSI">MSI (Suprim/Gaming)</option>
                      <option value="Gigabyte">Gigabyte (Aorus/Windforce)</option>
                      <option value="EVGA">EVGA (FTW/XC)</option>
                      <option value="Zotac">Zotac (AMP/Trinity)</option>
                      <option value="PNY">PNY (XLR8)</option>
                      <option value="Gainward">Gainward (Phantom)</option>
                      <option value="Palit">Palit (GameRock)</option>
                      <option value="Inno3D">Inno3D (iChill)</option>
                      <option value="Colorful">Colorful (iGame)</option>
                      <option value="Galax">Galax (HOF)</option>
                      <option value="KFA2">KFA2</option>
                      <option value="Manli">Manli</option>
                    </>}
                    {(!settings.gpuBrand || settings.gpuBrand === 'any' || settings.gpuBrand === 'AMD') && <>
                      <option value="ASUS">ASUS (ROG/TUF)</option>
                      <option value="MSI">MSI (Gaming X)</option>
                      <option value="Gigabyte">Gigabyte (Aorus/Gaming)</option>
                      <option value="Sapphire">Sapphire (Nitro/Pulse)</option>
                      <option value="PowerColor">PowerColor (Red Devil)</option>
                      <option value="XFX">XFX (Speedster/MERC)</option>
                      <option value="ASRock">ASRock (Taichi/Challenger)</option>
                      <option value="Yeston">Yeston</option>
                    </>}
                    {(!settings.gpuBrand || settings.gpuBrand === 'any' || settings.gpuBrand === 'Intel') && <>
                      <option value="ASUS">ASUS</option>
                      <option value="MSI">MSI</option>
                      <option value="Gigabyte">Gigabyte</option>
                      <option value="ASRock">ASRock</option>
                      <option value="Sparkle">Sparkle</option>
                      <option value="GUNNIR">GUNNIR</option>
                    </>}
                  </select>
                </div>
              </div>
              <div className="settings-section">
                <h3>Motherboard</h3>
                <div className="setting-group">
                  <label htmlFor="mbBrand">Brand</label>
                  <select id="mbBrand" value={settings.mbBrand} onChange={(e) => setSettings({ ...settings, mbBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="ASUS">ASUS (ROG/ProArt/TUF)</option>
                    <option value="MSI">MSI (MEG/MPG/MAG)</option>
                    <option value="Gigabyte">Gigabyte (Aorus/Gaming)</option>
                    <option value="ASRock">ASRock (Taichi/Steel Legend)</option>
                    <option value="NZXT">NZXT</option>
                    <option value="Biostar">Biostar</option>
                    <option value="EVGA">EVGA</option>
                    <option value="Supermicro">Supermicro (Server)</option>
                  </select>
                </div>
              </div>
              <div className="settings-section">
                <h3>Memory</h3>
                <div className="setting-group">
                  <label htmlFor="ramBrand">Brand</label>
                  <select id="ramBrand" value={settings.ramBrand} onChange={(e) => setSettings({ ...settings, ramBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="Corsair">Corsair (Vengeance/Dominator)</option>
                    <option value="G.Skill">G.Skill (Trident Z/Ripjaws)</option>
                    <option value="Kingston">Kingston (Fury/Renegade)</option>
                    <option value="Crucial">Crucial (Pro/CT)</option>
                    <option value="Team Group">Team Group (T-Force/Delta)</option>
                    <option value="ADATA">ADATA (XPG Spectrix/Lancer)</option>
                    <option value="PNY">PNY (XLR8)</option>
                    <option value="Patriot">Patriot (Viper/Signature)</option>
                    <option value="Silicon Power">Silicon Power</option>
                    <option value="Thermaltake">Thermaltake (Toughram)</option>
                    <option value="Mushkin">Mushkin (Redline)</option>
                    <option value="Lexar">Lexar</option>
                    <option value="Samsung">Samsung (OEM)</option>
                    <option value="SK Hynix">SK Hynix (OEM)</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="ramType">Type</label>
                  <select id="ramType" value={settings.ramType} onChange={(e) => setSettings({ ...settings, ramType: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="DDR5">DDR5 (Latest - 4800-8400+ MHz)</option>
                    <option value="DDR4">DDR4 (Standard - 2133-5000+ MHz)</option>
                    <option value="DDR3">DDR3 (Legacy - 1333-2133 MHz)</option>
                  </select>
                </div>
              </div>
              <div className="settings-section">
                <h3>Storage</h3>
                <div className="setting-group">
                  <label htmlFor="storageBrand">Brand</label>
                  <select id="storageBrand" value={settings.storageBrand} onChange={(e) => setSettings({ ...settings, storageBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="Samsung">Samsung (990 Pro/980 Pro/EVO)</option>
                    <option value="Western Digital">Western Digital (Black/Blue)</option>
                    <option value="Seagate">Seagate (Barracuda/FireCuda)</option>
                    <option value="Crucial">Crucial (T700/P3/P5 Plus)</option>
                    <option value="Kingston">Kingston (KC3000/FURY Renegade)</option>
                    <option value="Sabrent">Sabrent (Rocket 4/5)</option>
                    <option value="SK Hynix">SK Hynix (Platinum P41)</option>
                    <option value="ADATA">ADATA (XPG Gammix/SX8200)</option>
                    <option value="Corsair">Corsair (MP700/MP600)</option>
                    <option value="Lexar">Lexar (NM800 Pro)</option>
                    <option value="Solidigm">Solidigm (P44 Pro)</option>
                  </select>
                </div>
              </div>
              <div className="settings-section">
                <h3>Other Components</h3>
                <div className="setting-group">
                  <label htmlFor="psuBrand">PSU Brand</label>
                  <select id="psuBrand" value={settings.psuBrand} onChange={(e) => setSettings({ ...settings, psuBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="Corsair">Corsair (RMx/HX/AX)</option>
                    <option value="EVGA">EVGA (SuperNOVA)</option>
                    <option value="Seasonic">Seasonic (Prime/Focus)</option>
                    <option value="be quiet!">be quiet! (Dark Power)</option>
                    <option value="Thermaltake">Thermaltake (Toughpower)</option>
                    <option value="Super Flower">Super Flower (Leadex)</option>
                    <option value="Antec">Antec (TruePower/HCG)</option>
                    <option value="Cooler Master">Cooler Master (V/MWE)</option>
                    <option value="FSP">FSP (Hydro/PT)</option>
                    <option value="SilverStone">SilverStone (Strider)</option>
                    <option value="NZXT">NZXT (C/E)</option>
                    <option value="Fractal Design">Fractal Design (Ion)</option>
                    <option value="Phanteks">Phanteks (Revolt/AMP)</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="caseBrand">Case Brand</label>
                  <select id="caseBrand" value={settings.caseBrand} onChange={(e) => setSettings({ ...settings, caseBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="NZXT">NZXT (H Series/Z Series)</option>
                    <option value="Corsair">Corsair (4000D/5000D/iCUE)</option>
                    <option value="Lian Li">Lian Li (O11/PC-O11)</option>
                    <option value="Fractal Design">Fractal Design (Define/Torrent)</option>
                    <option value="be quiet!">be quiet! (Pure Base/Dark Base)</option>
                    <option value="Phanteks">Phanteks (Eclipse/G360A)</option>
                    <option value="Cooler Master">Cooler Master (HAF/NZXT)</option>
                    <option value="Thermaltake">Thermaltake (View/Core)</option>
                    <option value="Deepcool">Deepcool (CH/MATREXX)</option>
                    <option value="Montech">Montech (Air/Sky)</option>
                    <option value="Hyte">Hyte (Y60/Y70)</option>
                    <option value="Antec">Antec (Performance One)</option>
                    <option value="SilverStone">SilverStone (Raven/Fara)</option>
                    <option value="SSUPD">SSUPD (Meshlicious)</option>
                    <option value="FormD">FormD (T1)</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="coolerBrand">CPU Cooler Brand</label>
                  <select id="coolerBrand" value={settings.coolerBrand} onChange={(e) => setSettings({ ...settings, coolerBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="Noctua">Noctua (NH-D15/u12A)</option>
                    <option value="be quiet!">be quiet! (Dark Rock/Silent Loop)</option>
                    <option value="Corsair">Corsair (iCUE H150i)</option>
                    <option value="Cooler Master">Cooler Master (Hyper/ML)</option>
                    <option value="DeepCool">DeepCool (AK620/LS720)</option>
                    <option value="Arctic">Arctic (Freezer/Liquid Freezer)</option>
                    <option value="Thermalright">Thermalright (Peerless Assassin)</option>
                    <option value="NZXT">NZXT (Kraken)</option>
                    <option value="Lian Li">Lian Li (Galahad)</option>
                    <option value="Scythe">Scythe (Fuma/Fugen)</option>
                    <option value="EK">EK (Quantum/Fluid Gaming)</option>
                    <option value="ID-Cooling">ID-Cooling (SE/Flow)</option>
                    <option value="CRYORIG">CRYORIG (H7/C7)</option>
                  </select>
                </div>
              </div>
              <div className="settings-section">
                <h3>Peripherals</h3>
                <div className="setting-group">
                  <label htmlFor="monitorBrand">Monitor Brand</label>
                  <select id="monitorBrand" value={settings.monitorBrand} onChange={(e) => setSettings({ ...settings, monitorBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="ASUS">ASUS (ROG/TUF/ProArt)</option>
                    <option value="Dell">Dell (Alienware/UltraSharp)</option>
                    <option value="LG">LG (UltraGear/UltraFine)</option>
                    <option value="Samsung">Samsung (Odyssey/ViewFinity)</option>
                    <option value="AOC">AOC (AGON/Gaming)</option>
                    <option value="BenQ">BenQ (MOBIUZ/ZOWIE)</option>
                    <option value="ViewSonic">ViewSonic (Elite/XG)</option>
                    <option value="MSI">MSI (MEG/MPG/MAG)</option>
                    <option value="Gigabyte">Gigabyte (Aorus/M)</option>
                    <option value="Acer">Acer (Predator/Nitro)</option>
                    <option value="Apple">Apple (Pro Display/Studio)</option>
                    <option value="HP">HP (Omen/Pavilion)</option>
                    <option value="Lenovo">Lenovo (Legion/ThinkVision)</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="keyboardBrand">Keyboard Brand</label>
                  <select id="keyboardBrand" value={settings.keyboardBrand} onChange={(e) => setSettings({ ...settings, keyboardBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="Corsair">Corsair (K100/K70/K65)</option>
                    <option value="Razer">Razer (Huntsman/BlackWidow)</option>
                    <option value="Logitech">Logitech (G915/G Pro)</option>
                    <option value="Ducky">Ducky (One/Meeka)</option>
                    <option value="Keychron">Keychron (Q/K Pro)</option>
                    <option value="SteelSeries">SteelSeries (Apex)</option>
                    <option value="HyperX">HyperX (Alloy/Origins)</option>
                    <option value="Leopold">Leopold (FC/FC900R)</option>
                    <option value="Varmilo">Varmilo (VA/Minilo)</option>
                    <option value="Wooting">Wooting (60HE/Two HE)</option>
                    <option value="Drop">Drop (ALT/CTRL)</option>
                    <option value="GMMK">Glorious GMMK</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="mouseBrand">Mouse Brand</label>
                  <select id="mouseBrand" value={settings.mouseBrand} onChange={(e) => setSettings({ ...settings, mouseBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="Logitech">Logitech (G Pro X/G502)</option>
                    <option value="Razer">Razer (DeathAdder/Viper)</option>
                    <option value="SteelSeries">SteelSeries (Rival/Aerox)</option>
                    <option value="Zowie">Zowie (EC/FK/ZA)</option>
                    <option value="Corsair">Corsair (Dark Core/M65)</option>
                    <option value="Roccat">Roccat (Kone/Nyuz)</option>
                    <option value="HyperX">HyperX (Pulsefire)</option>
                    <option value="Pulsar">Pulsar (X2/PRX)</option>
                    <option value="Glorious">Glorious (Model O/D)</option>
                    <option value="Finalmouse">Finalmouse (Starlight)</option>
                    <option value="Endgame Gear">Endgame Gear (OP1/XM1)</option>
                    <option value="Lamzu">Lamzu (Atlantis/Maya)</option>
                    <option value="Vaxee">Vaxee (XE/PA)</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor="headphoneBrand">Headphone Brand</label>
                  <select id="headphoneBrand" value={settings.headphoneBrand} onChange={(e) => setSettings({ ...settings, headphoneBrand: e.target.value })}>
                    <option value="any">Any</option>
                    <option value="HyperX">HyperX (Cloud II/Alpha)</option>
                    <option value="SteelSeries">SteelSeries (Arctis/Nova)</option>
                    <option value="Razer">Razer (BlackShark/Kraken)</option>
                    <option value="Logitech">Logitech (G Pro X/G733)</option>
                    <option value="Sennheiser">Sennheiser (HD 599/HD 660S)</option>
                    <option value="Audio-Technica">Audio-Technica (ATH-M50x)</option>
                    <option value="Beyerdynamic">Beyerdynamic (DT 770/990 Pro)</option>
                    <option value="Corsair">Corsair (Virtuoso/HS)</option>
                    <option value="Astro">Astro (A40/A50)</option>
                    <option value="Sony">Sony (WH-1000XM5/MDR)</option>
                    <option value="Bose">Bose (700/QuietComfort)</option>
                    <option value="EPOS">EPOS (H6PRO/H3)</option>
                    <option value="Drop">Drop + Sennheiser</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={resetSettings}>Reset All</button>
              <button className="btn-primary" onClick={saveSettings}>Save Settings</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
