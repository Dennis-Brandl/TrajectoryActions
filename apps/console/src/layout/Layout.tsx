import { Outlet } from 'react-router'
import TopNav from './TopNav'
import ActivityBar from './ActivityBar'
import SidePanel from './SidePanel'
import StatusBar from './StatusBar'
import RightPane from './RightPane'
import { RightPaneProvider } from './RightPaneContext'

export default function Layout() {
  return (
    <RightPaneProvider>
      <div className="flex flex-col h-screen bg-background">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <ActivityBar />
          <SidePanel />
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
          <RightPane />
        </div>
        <StatusBar />
      </div>
    </RightPaneProvider>
  )
}
