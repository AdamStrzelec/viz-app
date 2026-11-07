import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useTheme } from './useTheme'
import FeedbackLayer from './components/FeedbackLayer'
import BasicsPage from './pages/BasicsPage'
import BlocksPage from './pages/BlocksPage'
import ContextGuardsPage from './pages/ContextGuardsPage'
import HierarchyPage from './pages/HierarchyPage'
import AsyncActorsPage from './pages/AsyncActorsPage'
import InspectorPage from './pages/InspectorPage'
import MoreApiPage from './pages/MoreApiPage'
import ReleasePage from './pages/ReleasePage'
import GatesGamePage from './pages/GatesGamePage'
import GitWorkflowPage from './pages/GitWorkflowPage'
import SshForcedCommandPage from './pages/SshForcedCommandPage'
import ApiReferencePage from './pages/ApiReferencePage'

const pages = [
  { path: '/basics', label: 'Basics', element: <BasicsPage />, group: 'Examples' },
  { path: '/context-guards', label: 'Context & guards', element: <ContextGuardsPage />, group: 'Examples' },
  { path: '/hierarchy', label: 'Nested & parallel', element: <HierarchyPage />, group: 'Examples' },
  { path: '/async-actors', label: 'Async & actors', element: <AsyncActorsPage />, group: 'Examples' },
  { path: '/inspector', label: 'Inspector', element: <InspectorPage />, group: 'Examples' },
  { path: '/more-api', label: 'More API', element: <MoreApiPage />, group: 'Examples' },
  { path: '/blocks', label: 'Bloki i sekwencje', element: <BlocksPage />, group: 'Examples' },
  { path: '/release', label: 'Release model', element: <ReleasePage />, group: 'Projects' },
  { path: '/gates', label: 'Logic gates game', element: <GatesGamePage />, group: 'Projects' },
  { path: '/git-workflow', label: 'Git workflow', element: <GitWorkflowPage />, group: 'Projects' },
  { path: '/ssh-gate', label: 'SSH forced command', element: <SshForcedCommandPage />, group: 'Projects' },
  { path: '/api-reference', label: 'API reference', element: <ApiReferencePage />, group: 'Reference' },
]

const groups = [...new Set(pages.map((p) => p.group))]

export default function App() {
  const { theme, toggle } = useTheme()

  return (
    <div className="layout">
      {import.meta.env.DEV && <FeedbackLayer />}
      <nav>
        <h1>viz-app</h1>
        {groups.map((group) => (
          <div key={group} className="nav-group">
            <span className="nav-group-label">{group}</span>
            {pages
              .filter((p) => p.group === group)
              .map((p) => (
                <NavLink key={p.path} to={p.path}>
                  {p.label}
                </NavLink>
              ))}
          </div>
        ))}
        <button className="theme-toggle" onClick={toggle} aria-label="Toggle color theme">
          {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/basics" replace />} />
          {pages.map((p) => (
            <Route key={p.path} path={p.path} element={p.element} />
          ))}
        </Routes>
      </main>
    </div>
  )
}
