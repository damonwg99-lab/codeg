"use client"

import { AppWorkspaceProvider } from "@/contexts/app-workspace-context"
import { ActiveFolderProvider } from "@/contexts/active-folder-context"
import { AlertProvider } from "@/contexts/alert-context"
import { AcpConnectionsProvider } from "@/contexts/acp-connections-context"
import { WorkspaceProvider } from "@/contexts/workspace-context"
import { TabProvider } from "@/contexts/tab-context"
import { SearchDialogProvider } from "@/contexts/search-dialog-context"
import { PlatformProvider } from "@/contexts/platform-context"
import { SidebarProvider } from "@/contexts/sidebar-context"
import { Sidebar } from "@/components/layout/sidebar"
import { SidebarProjectPanel } from "@/components/platform/sidebar-project-panel"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PlatformProvider>
      <AppWorkspaceProvider>
        <ActiveFolderProvider>
          <AlertProvider>
            <AcpConnectionsProvider>
              <WorkspaceProvider>
                <TabProvider>
                  <SearchDialogProvider>
                    <SidebarProvider>
                      <div className="flex h-screen w-screen overflow-hidden">
                        <ResizablePanelGroup
                          direction="horizontal"
                          autoSaveId="platform-layout"
                        >
                          <ResizablePanel
                            defaultSize={20}
                            minSize={15}
                            maxSize={40}
                            order={1}
                          >
                            <Sidebar tab="project">
                              <SidebarProjectPanel />
                            </Sidebar>
                          </ResizablePanel>
                          <ResizableHandle withHandle />
                          <ResizablePanel defaultSize={80} order={2}>
                            <main className="flex h-full flex-col overflow-hidden">
                              {children}
                            </main>
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </div>
                    </SidebarProvider>
                  </SearchDialogProvider>
                </TabProvider>
              </WorkspaceProvider>
            </AcpConnectionsProvider>
          </AlertProvider>
        </ActiveFolderProvider>
      </AppWorkspaceProvider>
    </PlatformProvider>
  )
}
