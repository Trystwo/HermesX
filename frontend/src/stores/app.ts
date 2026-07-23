import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppState {
  selectedStrategyId: string | null
  sidebarCollapsed: boolean
  mobileSidebarOpen: boolean
  setSelectedStrategyId: (id: string | null) => void
  toggleSidebar: () => void
  setMobileSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedStrategyId: null,
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      setSelectedStrategyId: (id) => set({ selectedStrategyId: id }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
    }),
    {
      name: 'hermesx-app',
      partialize: (state) => ({
        selectedStrategyId: state.selectedStrategyId,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
)
