import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import BasicsPage from './pages/BasicsPage'
import ContextGuardsPage from './pages/ContextGuardsPage'
import HierarchyPage from './pages/HierarchyPage'
import AsyncActorsPage from './pages/AsyncActorsPage'
import InspectorPage from './pages/InspectorPage'
import MoreApiPage from './pages/MoreApiPage'
import ReleasePage from './pages/ReleasePage'
import GatesGamePage from './pages/GatesGamePage'
import ApiReferencePage from './pages/ApiReferencePage'

const pages = [
  { path: '/basics', label: 'Basics', element: <BasicsPage /> },
  { path: '/context-guards', label: 'Context & guards', element: <ContextGuardsPage /> },
  { path: '/hierarchy', label: 'Nested & parallel', element: <HierarchyPage /> },
  { path: '/async-actors', label: 'Async & actors', element: <AsyncActorsPage /> },
  { path: '/inspector', label: 'Inspector', element: <InspectorPage /> },
  { path: '/more-api', label: 'More API', element: <MoreApiPage /> },
  { path: '/release', label: 'Release model', element: <ReleasePage /> },
  { path: '/gates', label: 'Logic gates game', element: <GatesGamePage /> },
  { path: '/api-reference', label: 'API reference', element: <ApiReferencePage /> },
]

export default function App() {
  return (
    <div className="layout">
      <nav>
        <h1>viz-app</h1>
        {pages.map((p) => (
          <NavLink key={p.path} to={p.path}>
            {p.label}
          </NavLink>
        ))}
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
