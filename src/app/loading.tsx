export default function Loading() {
  return (
    <div className="build-container">
      <div className="build-header">
        <h1 className="build-title">AI PC Build Generator</h1>
        <p className="build-subtitle">Loading...</p>
      </div>
      <div className="ai-build-loading">
        <div className="loading-animation">
          <div className="loading-ring"></div>
          <div className="loading-ring"></div>
          <div className="loading-ring"></div>
        </div>
        <p className="loading-text">Preparing your experience...</p>
      </div>
    </div>
  )
}
