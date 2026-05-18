import type { Instance } from '@trajectory/storage'
import {
  InstanceRepository,
  ActionRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
  SettingsRepository,
} from '@trajectory/storage'

export class ExecutionLogger {
  constructor(
    private readonly actionRepo: ActionRepository,
    private readonly environmentRepo: EnvironmentRepository,
    private readonly codeVersionRepo: CodeVersionRepository,
    private readonly logRepo: LogRepository,
    private readonly settingsRepo: SettingsRepository,
    private readonly instanceRepo: InstanceRepository
  ) {}

  writeLog(instanceId: string, terminalState: string, instance: Instance): void {
    // Guard: already logged
    if (instance.is_logged) return

    const action = this.actionRepo.findByOid(instance.action_oid)
    const environment = this.environmentRepo.findByOid(instance.environment_oid)
    const logMaxSize = this.settingsRepo.getNumericValue('log_max_size') ?? 10000

    const completedAt = instance.completed_at ?? new Date().toISOString()
    const startedAt = instance.started_at ?? instance.created_at // Fallback per research Pitfall 4
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()

    // Build code_versions_used from pinned versions
    const codeVersionsUsed: Record<string, number> = {}
    const pinnedVersions = instance.pinned_code_versions as Array<{
      state: string
      code_version_id: string
    }>
    for (const pinned of pinnedVersions) {
      const version = this.codeVersionRepo.findById(pinned.code_version_id)
      if (version) {
        codeVersionsUsed[pinned.state] = version.version_number
      }
    }

    this.logRepo.insert(
      {
        runtime_action_instance_id: instanceId,
        action_oid: instance.action_oid,
        action_name: action?.local_id ?? instance.action_oid,
        environment_oid: instance.environment_oid,
        environment_name: environment?.local_id ?? '',
        workflow_instance_id: instance.workflow_instance_id,
        step_oid: instance.step_oid,
        input_parameters: instance.input_parameters,
        output_parameters: instance.output_parameters,
        states_executed: instance.states_with_code_executed,
        code_versions_used: codeVersionsUsed,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        final_status: terminalState as 'COMPLETED' | 'ABORTED' | 'STOPPED',
        error: instance.error ?? undefined,
      },
      logMaxSize
    )

    this.instanceRepo.markLogged(instanceId)
  }
}
