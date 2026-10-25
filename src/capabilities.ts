/**
 * The capability map, rendered by `/asc`, `/asc-doctor` and generated docs.
 *
 * One source of truth for "what can this plugin do": jobs first (the product
 * surface), then the low-level tools they build on.
 */

/** One product-level job. */
export interface CapabilityJob {
  /** `asc_job` action id, also the skill suffix. */
  readonly id: string
  readonly title: string
  /** Natural-language intents the job answers. */
  readonly intent: readonly string[]
  readonly risk: 'read' | 'write'
  readonly needsConfirm: boolean
  readonly ascCommands: readonly string[]
  readonly skill: string
}

/** The jobs shipped in 0.1.3. */
export const JOBS: readonly CapabilityJob[] = [
  {
    id: 'release-check',
    title: '发版前体检',
    intent: ['这版能发了吗', '卡在哪、先修什么', '提交前检查'],
    risk: 'read',
    needsConfirm: false,
    ascCommands: ['asc validate --app'],
    skill: 'dsh-asc-release-readiness',
  },
  {
    id: 'ship-testflight',
    title: '发 TestFlight',
    intent: ['把这个包发到内部测试组', '上测试', '分发 build'],
    risk: 'write',
    needsConfirm: true,
    ascCommands: ['asc builds upload', 'asc builds add-groups'],
    skill: 'dsh-asc-testflight-ship',
  },
  {
    id: 'stage-release',
    title: '准备审核版本',
    intent: ['把 1.2.3 准备好但先别提交', '挂 build、配元数据', 'stage'],
    risk: 'write',
    needsConfirm: true,
    ascCommands: ['asc validate --app', 'asc release stage'],
    skill: 'dsh-asc-release-readiness',
  },
  {
    id: 'triage-feedback',
    title: '反馈与评论分诊',
    intent: ['测试员在抱怨什么', '崩溃和反馈归类', '评论怎么回'],
    risk: 'read',
    needsConfirm: false,
    ascCommands: ['asc testflight feedback list', 'asc testflight crashes list', 'asc reviews list'],
    skill: 'dsh-asc-feedback-triage',
  },
  {
    id: 'compliance-sweep',
    title: '合规巡检',
    intent: ['哪些 app 会因为新规发不出去', '年龄分级/加密/可访问性/定价状态', '上架前合规检查'],
    risk: 'read',
    needsConfirm: false,
    ascCommands: [
      'asc age-rating view --app',
      'asc encryption declarations list --app',
      'asc accessibility list --app',
      'asc pricing current --app',
    ],
    skill: 'dsh-asc-compliance-sweep',
  },
]

/** Low-level tools the jobs build on, for the capability card. */
export const TOOLS: readonly { readonly name: string; readonly purpose: string }[] = [
  { name: 'asc_job', purpose: 'Run one of the five jobs above (preferred entry point)' },
  { name: 'asc', purpose: 'Reads: apps/builds/TestFlight/reviews/metadata-validate, plus discover and run' },
  { name: 'asc_plan', purpose: 'validate, status, metadata-plan' },
  { name: 'asc_apply', purpose: 'upload, groups, metadata init/apply, stage, publish' },
  { name: 'asc_setup', purpose: 'version/auth/doctor/system-status/diagnose/provision/install-skills' },
]

/** Skills shipped inside the package (bundle rank). */
export const BUNDLED_SKILLS: readonly string[] = [
  'dsh-asc-quickstart',
  'dsh-asc-auth',
  'dsh-asc-release-readiness',
  'dsh-asc-testflight-ship',
  'dsh-asc-feedback-triage',
  'dsh-asc-compliance-sweep',
]

/** Look one job up by id. */
export function jobCapability(id: string): CapabilityJob | undefined {
  return JOBS.find((job) => job.id === id)
}
