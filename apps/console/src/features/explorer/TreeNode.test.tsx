import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EnvironmentNode } from './TreeNode'

const deleteMutateAsync = vi.fn().mockResolvedValue({})
const exportRun = vi.fn().mockResolvedValue(undefined)
const reportRun = vi.fn().mockResolvedValue(undefined)

vi.mock('@/features/environments/hooks', () => ({
  useDeleteEnvironment: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
  useExportEnvironment: () => ({ run: exportRun, isPending: false, error: null }),
  useGenerateEnvironmentReport: () => ({ run: reportRun, isPending: false, error: null }),
}))

// Mock @trajectory/ui DropdownMenu primitives to avoid cross-repo React
// instance conflicts (the package is symlinked from TrajectoryEditor which has
// its own node_modules/react, causing "Invalid hook call" in tests).
// Note: this mock always renders DropdownMenuContent's children, so the
// "opens menu" assertion verifies item presence after render, not the
// click-to-open semantic.
vi.mock('@trajectory/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@trajectory/ui')>()
  return {
    ...original,
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
    DropdownMenuTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode
      asChild?: boolean
    }) =>
      asChild
        ? React.cloneElement(children as React.ReactElement)
        : React.createElement('div', null, children),
    DropdownMenuContent: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler
    }) => React.createElement('div', { 'data-testid': 'dropdown-content', onClick }, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: React.ReactNode
      onSelect?: () => void
      disabled?: boolean
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          disabled,
          onClick: () => !disabled && onSelect?.(),
          role: 'menuitem',
        },
        children
      ),
    DropdownMenuSeparator: () => React.createElement('hr', null),
  }
})

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('EnvironmentNode', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    deleteMutateAsync.mockClear()
    exportRun.mockClear()
    reportRun.mockClear()
  })

  const baseProps = {
    oid: 'env-oid',
    localId: 'TestEnv',
    actions: [],
    actionCount: 5,
    version: '3',
    lastModifiedDate: '2026-05-10T00:00:00.000Z',
    onActionError: vi.fn(),
  }

  it('renders the two-line row with name + version/date metadata', () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    expect(screen.getByText('TestEnv')).toBeInTheDocument()
    expect(screen.getByText(/\[v3\]/)).toBeInTheDocument()
    expect(screen.getByText(/imported 5\/10/)).toBeInTheDocument()
  })

  it('opens a dropdown menu with three items when the kebab is clicked', async () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    const trigger = screen.getByRole('button', { name: /environment actions/i })
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByText('Export Envir Package')).toBeInTheDocument()
      expect(screen.getByText('Generate PDF report')).toBeInTheDocument()
      expect(screen.getByText('Delete environment')).toBeInTheDocument()
    })
  })

  it('clicking Delete confirms then triggers the mutation', async () => {
    renderWithProviders(<EnvironmentNode {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /environment actions/i }))
    await waitFor(() => screen.getByText('Delete environment'))
    fireEvent.click(screen.getByText('Delete environment'))
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Delete environment "TestEnv"')
    )
    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith('env-oid')
    })
  })
})
