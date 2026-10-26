// Opening screen while the first feed load finishes.
// CSS only: a few small transforms. No canvas, blur, or full-window redraw,
// because this window paints on the CPU.
export default function IntroLoader() {
  return (
    <div className="intro" role="status" aria-label="Loading your feed">
      <div className="intro-halo" aria-hidden />
      <div className="intro-mark">
        <span className="intro-ring" aria-hidden />
        <svg className="intro-play" viewBox="0 0 24 24" aria-hidden>
          <path fill="#fff" d="M9 7v10l8-5z" />
        </svg>
      </div>
      <p className="intro-name">Kovatube</p>
      <div className="intro-track" aria-hidden>
        <span className="intro-bar" />
      </div>
    </div>
  )
}
