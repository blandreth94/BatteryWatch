import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { useMatchSchedule } from './store/useMatchSchedule'
import { useSettings } from './store/useSettings'
import Dashboard from './views/Dashboard'
import ChargerBoard from './views/ChargerBoard'
import Batteries from './views/Batteries'
import MatchSchedule from './views/MatchSchedule'
import Settings from './views/Settings'

function Header() {
  const settings = useSettings()
  const matches = useMatchSchedule()
  const nextMatch = matches.find((m) => m.status === 'upcoming')
  const activeMatch = matches.find((m) => m.status === 'active')

  const countdownLabel = (() => {
    const target = activeMatch ?? nextMatch
    if (!target) return null
    const diffMs = target.scheduledTime - Date.now()
    const diffMin = Math.round(diffMs / 60_000)
    if (activeMatch) return `Match ${target.matchNumber} ▶`
    if (diffMin <= 0) return `Match ${target.matchNumber} NOW`
    if (diffMin < 60) return `M${target.matchNumber} in ${diffMin}m`
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    return `M${target.matchNumber} in ${h}h ${m}m`
  })()

  return (
    <header className="app-header">
      <div className="app-header__title">⚡ BatteryWatch</div>
      <div className="app-header__meta">
        {countdownLabel && <div className="app-header__countdown">{countdownLabel}</div>}
        <div>{settings.eventName || `Team ${settings.teamNumber}`}</div>
      </div>
    </header>
  )
}

function Nav() {
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => 'bottom-nav__item' + (isActive ? ' active' : '')}>
        <span className="bottom-nav__icon">🏠</span>
        <span>Dashboard</span>
      </NavLink>
      <NavLink to="/chargers" className={({ isActive }) => 'bottom-nav__item' + (isActive ? ' active' : '')}>
        <span className="bottom-nav__icon">🔋</span>
        <span>Chargers</span>
      </NavLink>
      <NavLink to="/batteries" className={({ isActive }) => 'bottom-nav__item' + (isActive ? ' active' : '')}>
        <span className="bottom-nav__icon">📋</span>
        <span>Batteries</span>
      </NavLink>
      <NavLink to="/schedule" className={({ isActive }) => 'bottom-nav__item' + (isActive ? ' active' : '')}>
        <span className="bottom-nav__icon">📅</span>
        <span>Schedule</span>
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => 'bottom-nav__item' + (isActive ? ' active' : '')}>
        <span className="bottom-nav__icon">⚙️</span>
        <span>Settings</span>
      </NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <Header />
        <Nav />
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/chargers" element={<ChargerBoard />} />
            <Route path="/batteries" element={<Batteries />} />
            <Route path="/schedule" element={<MatchSchedule />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
