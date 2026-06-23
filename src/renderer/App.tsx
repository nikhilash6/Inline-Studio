import { useEffect } from 'react'
import { useProjectStore } from './store/projectStore'
import { useUpdateStore } from './store/updateStore'
import { ProjectLauncher } from './views/ProjectLauncher/ProjectLauncher'
import { Workspace } from './views/Workspace/Workspace'
import { UpdateBanner } from './components/UpdateBanner'

export function App(): React.JSX.Element {
  const current = useProjectStore((s) => s.current)
  const loadRecents = useProjectStore((s) => s.loadRecents)
  const subscribeToUpdates = useUpdateStore((s) => s.subscribeToEvents)

  useEffect(() => {
    void loadRecents()
  }, [loadRecents])

  useEffect(() => subscribeToUpdates(), [subscribeToUpdates])

  return (
    <>
      <UpdateBanner />
      {current ? <Workspace project={current} /> : <ProjectLauncher />}
    </>
  )
}
