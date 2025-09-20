// App.jsx
// 한 파일 React 앱: 휴대폰 카메라에서 사진 촬영 -> 브라우저에서 OCR (Tesseract.js)
// 주요 기능: 실시간 카메라, 지시선(오버레이), 수동/자동 촬영, OCR 결과 보기, 이미지 다운로드/복사
// 사용법 요약:
// 1) 프로젝트 생성: npx create-react-app my-ocr-app
// 2) 폴더로 이동 후 의존성 설치: npm install tesseract.js
// 3) Tailwind 사용을 원하면 Tailwind 설치/설정 (선택)
// 4) src/App.jsx 를 이 파일로 교체하고 npm start

import React, { useRef, useEffect, useState } from 'react'
import { createWorker } from 'tesseract.js'

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null) // for capture
  const overlayRef = useRef(null)
  const [stream, setStream] = useState(null)
  const [ocrText, setOcrText] = useState('')
  const [processing, setProcessing] = useState(false)
  const [autoCapture, setAutoCapture] = useState(false)
  const [worker, setWorker] = useState(null)
  const [facingMode, setFacingMode] = useState('environment') // rear camera by default
  const [lastCaptureDataUrl, setLastCaptureDataUrl] = useState(null)
  const [autoConfidenceThreshold, setAutoConfidenceThreshold] = useState(0.6)

  // 카메라 시작
  const startCamera = async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      })
      videoRef.current.srcObject = s
      await videoRef.current.play()
      setStream(s)
    } catch (e) {
      console.error('카메라 접근 실패', e)
      alert('카메라 권한이 필요합니다.')
    }
  }

  // Tesseract 워커 초기화
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const w = createWorker({ logger: m => {/* console.log(m) */} })
      await w.load()
      await w.loadLanguage('eng+kor')
      await w.initialize('eng+kor')
      if (mounted) setWorker(w)
    })()
    return () => { mounted = false }
  }, [])

  // 컴포넌트 마운트 시 카메라 시작
  useEffect(() => {
    startCamera()
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode])

  // 캡처 함수
  const capturePhoto = async () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    // 캔버스 크기: 비디오의 현재 사이즈
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setLastCaptureDataUrl(dataUrl)
    return dataUrl
  }

  // OCR 수행
  const runOcr = async (dataUrl) => {
    if (!worker) { alert('OCR 엔진 준비 중입니다. 잠시 기다려 주세요.'); return }
    setProcessing(true)
    setOcrText('')
    try {
      const { data: { text, confidence } } = await worker.recognize(dataUrl)
      setOcrText(text)
      console.log('ocr confidence (approx):', confidence)
    } catch (e) {
      console.error(e)
      alert('OCR 중 오류가 발생했습니다.')
    } finally {
      setProcessing(false)
    }
  }

  // 수동 촬영 + OCR
  const onCaptureClick = async () => {
    const dataUrl = await capturePhoto()
    await runOcr(dataUrl)
  }

  // 자동 촬영 로직: 단순 heuristic 사용
  // 중앙 가이드 박스 (overlay) 내의 대비 비율을 측정해서 임계치 넘으면 자동 촬영
  useEffect(() => {
    if (!autoCapture) return
    let rafId
    const check = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafId = requestAnimationFrame(check)
        return
      }
      const video = videoRef.current
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) { rafId = requestAnimationFrame(check); return }
      const tempCanvas = document.createElement('canvas')
      const ctx = tempCanvas.getContext('2d')
      // 중앙 박스: 영상의 60% 크기
      const boxW = Math.floor(w * 0.6)
      const boxH = Math.floor(h * 0.2)
      const boxX = Math.floor((w - boxW) / 2)
      const boxY = Math.floor((h - boxH) / 2)
      tempCanvas.width = boxW
      tempCanvas.height = boxH
      ctx.drawImage(video, boxX, boxY, boxW, boxH, 0, 0, boxW, boxH)
      const imgData = ctx.getImageData(0, 0, boxW, boxH)
      const pixels = imgData.data
      // 대충 대비/텍스트 존재 여부 판별: 회색도 분산(variance) 계산
      let sum = 0, sumSq = 0, len = boxW * boxH
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i+1], b = pixels[i+2]
        const gray = 0.299*r + 0.587*g + 0.114*b
        sum += gray
        sumSq += gray*gray
      }
      const mean = sum / len
      const variance = (sumSq / len) - (mean*mean)
      // console.log('variance', variance)
      // 임계치: variance가 어느 정도 이상이면(=텍스트나 대비가 있음) 캡처 시도
      const varianceThreshold = 500 // 기기에 따라 튜닝 필요
      if (variance > varianceThreshold && !processing) {
        // 자동 캡처: 캡처 후 OCR 실행
        const dataUrl = await capturePhoto()
        await runOcr(dataUrl)
        // 자동 캡처를 한 번만 수행하려면 autoCapture 비활성화 (또는 사용자가 원하면 계속)
        // 여기서는 잠깐 멈췄다가 다시 검사
        await new Promise(r => setTimeout(r, 1500))
      }
      rafId = requestAnimationFrame(check)
    }
    rafId = requestAnimationFrame(check)
    return () => cancelAnimationFrame(rafId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture, processing, worker])

  const toggleFacing = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')
  }

  const downloadImage = () => {
    if (!lastCaptureDataUrl) return
    const a = document.createElement('a')
    a.href = lastCaptureDataUrl
    a.download = 'capture.jpg'
    a.click()
  }

  const copyTextToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(ocrText)
      alert('텍스트가 클립보드에 복사되었습니다.')
    } catch (e) {
      alert('복사 실패')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-50 p-4">
      <h1 className="text-2xl font-bold mb-2">모바일 OCR 카메라 (React)</h1>
      <div className="w-full max-w-xl bg-white rounded-xl shadow p-3">
        <div className="relative" style={{aspectRatio: '3/4'}}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover rounded-md"
            playsInline
            muted
          />

          {/* 오버레이: 중앙 가이드 박스, 가로/세로 지시선 등 */}
          <div ref={overlayRef} className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* 어둡게 처리된 외곽 */}
            <div className="absolute inset-0" style={{boxShadow: 'inset 0 0 0 2000px rgba(0,0,0,0.25)'}} />
            {/* 중앙 가이드 박스 */}
            <div style={{width: '60%', height: '20%'}} className="relative border-2 border-dashed border-white rounded-md">
              {/* 십자선 */}
              <div className="absolute top-1/2 left-0 right-0 h-px bg-white/80" />
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/80" />
            </div>
          </div>

        </div>

        <div className="mt-3 flex gap-2 items-center">
          <button onClick={onCaptureClick} className="px-4 py-2 bg-blue-600 text-white rounded">촬영 & OCR</button>
          <button onClick={() => setAutoCapture(p => !p)} className="px-3 py-2 bg-gray-200 rounded">
            {autoCapture ? '자동촬영 중지' : '자동촬영 켜기'}
          </button>
          <button onClick={toggleFacing} className="px-3 py-2 bg-gray-200 rounded">카메라 전환</button>
          <button onClick={downloadImage} className="px-3 py-2 bg-gray-200 rounded">이미지 다운로드</button>
        </div>

        <div className="mt-3">
          <label className="text-sm">자동촬영 대비 임계치(수동 튜닝): </label>
          <input type="range" min="100" max="2000" value={autoConfidenceThreshold*1000} onChange={e => setAutoConfidenceThreshold(e.target.value/1000)} />
          <div className="text-xs text-gray-500">현재값: {autoConfidenceThreshold.toFixed(2)}</div>
        </div>

        <div className="mt-3">
          <h2 className="font-semibold">OCR 결과</h2>
          <div className="min-h-[80px] p-2 border rounded bg-gray-100 whitespace-pre-wrap">{processing ? '처리중...' : (ocrText || '아직 OCR이 수행되지 않았습니다')}</div>
          <div className="mt-2 flex gap-2">
            <button onClick={copyTextToClipboard} className="px-3 py-2 bg-green-600 text-white rounded">복사</button>
            <button onClick={() => setOcrText('')} className="px-3 py-2 bg-red-400 text-white rounded">지우기</button>
          </div>
        </div>

        {lastCaptureDataUrl && (
          <div className="mt-3">
            <h3 className="font-medium">최근 촬영 이미지</h3>
            <img src={lastCaptureDataUrl} alt="capture" className="w-full rounded" />
          </div>
        )}

      </div>

      <canvas ref={canvasRef} style={{display:'none'}} />

      <div className="mt-4 text-sm text-gray-600 max-w-xl">
        <p>설명: 브라우저 내에서 Tesseract.js로 OCR을 수행합니다. 사진 촬영 시 중앙 가이드 박스에 문서를 맞추면 자동촬영(간단한 대비 기반 heuristic)이 동작합니다.</p>
        <p className="mt-2">주의: 모바일 브라우저(특히 iOS Safari)에서는 카메라 권한 정책이나 백그라운드 탭 제한이 있어 동작이 달라질 수 있습니다.</p>
      </div>
    </div>
  )
}
