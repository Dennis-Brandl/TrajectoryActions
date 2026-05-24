import { useState } from 'react'
import { Routes, Route } from 'react-router'
import Layout from './layout/Layout'
import { PanelProvider } from './layout/PanelContext'
import { WelcomeSplash } from './components/WelcomeSplash'
import DashboardPage from './features/dashboard/DashboardPage'
import EnvironmentsPage from './features/environments/EnvironmentsPage'
import EnvironmentDetailPage from './features/environments/EnvironmentDetailPage'
import ActionDetailPage from './features/actions/ActionDetailPage'
import CodeEditorPage from './features/code-editor/CodeEditorPage'
import InlineCodeEditorPage from './features/code-editor/InlineCodeEditorPage'
import InstancesPage from './features/instances/InstancesPage'
import InstanceDetailPage from './features/instances/InstanceDetailPage'
import LogPage from './features/log/LogPage'
import SettingsPage from './features/settings/SettingsPage'

export default function App() {
  const [splashDismissed, setSplashDismissed] = useState(false)

  if (!splashDismissed) {
    return <WelcomeSplash onContinue={() => setSplashDismissed(true)} />
  }

  return (
    <PanelProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="environments" element={<EnvironmentsPage />} />
          <Route path="environments/:oid" element={<EnvironmentDetailPage />} />
          <Route path="actions/:oid" element={<ActionDetailPage />} />
          <Route path="actions/:oid/code/:state" element={<InlineCodeEditorPage />} />
          <Route path="code-editor" element={<CodeEditorPage />} />
          <Route path="instances" element={<InstancesPage />} />
          <Route path="instances/:id" element={<InstanceDetailPage />} />
          <Route path="log" element={<LogPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </PanelProvider>
  )
}
