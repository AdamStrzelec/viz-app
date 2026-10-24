import { assign, setup } from 'xstate'

/**
 * Process model, not an infrastructure executor.
 * Ported from the release PR: models ordering, approvals, failures and retries.
 * Every release event carries the full SHA of the selected candidate.
 */

const FULL_SHA = /^[0-9a-f]{40}$/

export type ReleaseContext = {
  sha: string | null
  requestId: string | null
  stagingDeploymentId: string | null
  productionDeploymentId: string | null
  lastError: string | null
  failureAt: string | null
}

// Loose event shape: payload fields are validated by guards, like in the original model
export type ReleaseEvent = {
  type: string
  sha?: string
  requestId?: string
  deploymentId?: string
  recoveryVerified?: boolean
  confirmed?: boolean
  confirmSha?: string
  stagingDeploymentId?: string
  activeDeploymentId?: string
  domainsVerified?: boolean
  smokePassed?: boolean
  releaseRecorded?: boolean
  tagVerified?: boolean
  verified?: boolean
  rollbackDeploymentId?: string
  error?: string
  step?: string
}

type GuardArgs = { context: ReleaseContext; event: ReleaseEvent }

const sameSha = ({ context, event }: GuardArgs) => event.sha === context.sha
const isDeploymentId = (id: unknown): id is string => typeof id === 'string' && id.startsWith('dpl_')

const step = (label: string, next: string, failure: string, extraGuard: (args: GuardArgs) => boolean = () => true) => ({
  description: label,
  on: {
    STEP_OK: { guard: (args: GuardArgs) => sameSha(args) && extraGuard(args), target: next },
    STEP_FAILED: { guard: sameSha, target: failure, actions: 'rememberFailure' as const },
  },
})

const stagingStep = (label: string, next: string, guard?: (args: GuardArgs) => boolean) =>
  step(label, next, '#pulsoRelease.stagingFailed', guard)

const productionStep = (label: string, next: string, guard?: (args: GuardArgs) => boolean) =>
  step(label, next, '#pulsoRelease.productionFailed', guard)

export const releaseMachine = setup({
  types: { context: {} as ReleaseContext, events: {} as ReleaseEvent },
  actions: {
    selectCandidate: assign(({ event }) => ({
      sha: event.sha ?? null,
      requestId: event.requestId ?? null,
      stagingDeploymentId: null,
      productionDeploymentId: null,
      lastError: null,
      failureAt: null,
    })),
    acceptStaging: assign(({ event }) => ({ stagingDeploymentId: event.deploymentId ?? null })),
    rememberProductionDeployment: assign(({ event }) => ({ productionDeploymentId: event.deploymentId ?? null })),
    rememberFailure: assign(({ event }) => ({
      lastError: event.error ?? 'Nieznany błąd',
      failureAt: event.step ?? 'Sprawdź stan maszyny i log wykonania',
    })),
  },
}).createMachine({
  id: 'pulsoRelease',
  initial: 'idle',
  context: {
    sha: null,
    requestId: null,
    stagingDeploymentId: null,
    productionDeploymentId: null,
    lastError: null,
    failureAt: null,
  },
  states: {
    idle: {
      description: 'Brak wybranego kandydata.',
      on: {
        SELECT_CANDIDATE: {
          guard: ({ event }) => FULL_SHA.test(event.sha ?? ''),
          target: 'validatingCandidate',
          actions: 'selectCandidate',
        },
      },
    },

    validatingCandidate: step('SHA z main, pełne wymagane CI, historia i możliwość FF.', 'staging', 'candidateRejected'),

    candidateRejected: {
      description: 'Kandydat odrzucony. Bez operacji wdrożeniowych.',
      on: {
        REVALIDATE: { guard: sameSha, target: 'validatingCandidate' },
        ABANDON: 'abandoned',
      },
    },

    staging: {
      description: 'Techniczne wdrożenie kandydata na staging.',
      initial: 'preflight',
      states: {
        preflight: stagingStep('Sprawdź projekt, bazę, konfigurację i stan staging.', 'migrate'),
        migrate: stagingStep('Lock → kontrola historii → Drizzle → Payload → kontrola → unlock.', 'push'),
        push: stagingStep('Przesuń staging przez FF do niezmiennego SHA.', 'deployment'),
        deployment: stagingStep(
          'Wybierz/utwórz deployment i potwierdź jego pełną tożsamość oraz READY.',
          'smokeDeployment',
          ({ event }) => isDeploymentId(event.deploymentId),
        ),
        smokeDeployment: stagingStep('Smoke konkretnego deploymentu staging.', 'domain'),
        domain: stagingStep('Domena staging wskazuje wybrany deployment; smoke domeny.', 'record'),
        record: stagingStep('Zapisz sukces technicznego wdrożenia staging z SHA i deployment ID.', 'complete'),
        complete: { type: 'final' },
      },
      onDone: 'awaitingStagingAcceptance',
    },

    stagingFailed: {
      description: 'Staging nieudany. Baza lub branch mogły już się zmienić.',
      on: {
        RETRY_STAGING: { guard: sameSha, target: 'validatingCandidate' },
        ABANDON: 'abandoned',
      },
    },

    awaitingStagingAcceptance: {
      description: 'Kandydat zamrożony. Pełne testy zdalne: auth, dostęp, lekcja, integracje.',
      on: {
        ACCEPT_STAGING: {
          guard: ({ context, event }) => sameSha({ context, event }) && event.confirmed === true && isDeploymentId(event.deploymentId),
          target: 'awaitingProductionApproval',
          actions: 'acceptStaging',
        },
        REJECT_STAGING: { guard: sameSha, target: 'abandoned' },
      },
    },

    awaitingProductionApproval: {
      description: 'Ręczne uruchomienie prod dla zaakceptowanego SHA; to nie approval drugiej osoby.',
      on: {
        APPROVE_PRODUCTION: {
          guard: ({ context, event }) =>
            sameSha({ context, event }) &&
            event.confirmSha === context.sha &&
            event.stagingDeploymentId === context.stagingDeploymentId &&
            event.confirmed === true,
          target: 'production',
        },
        ABANDON: 'abandoned',
      },
    },

    production: {
      description: 'Wdrożenie produkcyjne bez ruchu, potem publikacja.',
      initial: 'preflight',
      states: {
        preflight: productionStep('Sprawdź aktualny staging, akceptację, FF, projekt i brak auto-publikacji.', 'recovery'),
        recovery: productionStep(
          'Potwierdź recovery, kopię i aktualną historię schematu.',
          'migrate',
          ({ event }) => event.recoveryVerified === true,
        ),
        migrate: productionStep('Lock → baseline lub poprawne wznowienie → Drizzle → Payload → kontrola → unlock.', 'push'),
        push: productionStep('Ponownie sprawdź staging i wykonaj FF production.', 'deployment'),
        deployment: {
          description: 'Build produkcyjny bez ruchu; pełna tożsamość deploymentu i READY.',
          on: {
            STEP_OK: {
              guard: ({ context, event }) => sameSha({ context, event }) && isDeploymentId(event.deploymentId),
              target: 'smokeDeployment',
              actions: 'rememberProductionDeployment',
            },
            STEP_FAILED: { guard: sameSha, target: '#pulsoRelease.productionFailed', actions: 'rememberFailure' },
          },
        },
        smokeDeployment: productionStep('Bezpieczny smoke produkcyjnego deploymentu bez publikacji domen.', 'revalidate'),
        revalidate: productionStep('Przed promote ponownie sprawdź zdalny staging, SHA i deployment ID.', 'publish'),
        publish: step('Promuj dokładnie zweryfikowany deployment.', 'verifyDomains', '#pulsoRelease.reconciliationRequired'),
        verifyDomains: step(
          'Sprawdź przypisanie domen i wykonaj smoke domen produkcyjnych.',
          'record',
          '#pulsoRelease.reconciliationRequired',
        ),
        record: step(
          'Zapisz release, deployment ID, tag i obowiązek aktualizacji baseline schematu.',
          'complete',
          '#pulsoRelease.reconciliationRequired',
        ),
        complete: { type: 'final' },
      },
      onDone: 'released',
    },

    productionFailed: {
      description: 'Awaria przed publikacją. Nie zakładaj, że migracje zostały cofnięte.',
      on: {
        RETRY_PRODUCTION: { guard: sameSha, target: 'awaitingProductionApproval' },
        RECONCILE: { guard: sameSha, target: 'reconciliationRequired' },
      },
    },

    reconciliationRequired: {
      description: 'Niepewny stan po publikacji lub błąd zapisu. Najpierw odczytaj rzeczywisty stan.',
      on: {
        CONFIRM_RELEASED: {
          guard: ({ context, event }) =>
            sameSha({ context, event }) &&
            event.activeDeploymentId === context.productionDeploymentId &&
            event.domainsVerified === true &&
            event.smokePassed === true &&
            event.releaseRecorded === true &&
            event.tagVerified === true,
          target: 'released',
        },
        CONFIRM_NOT_PUBLISHED: {
          guard: ({ context, event }) => sameSha({ context, event }) && event.verified === true,
          target: 'awaitingProductionApproval',
        },
        REQUEST_ROLLBACK: { guard: sameSha, target: 'awaitingRollbackApproval' },
      },
    },

    released: {
      description: 'Wydanie zakończone. Nowy kandydat wymaga nowej instancji maszyny.',
      on: { REQUEST_ROLLBACK: { guard: sameSha, target: 'awaitingRollbackApproval' } },
    },

    awaitingRollbackApproval: {
      description: 'Osobna decyzja o rollbacku aplikacji; nie o cofnięciu bazy.',
      on: {
        APPROVE_ROLLBACK: {
          guard: ({ context, event }) =>
            sameSha({ context, event }) &&
            event.confirmed === true &&
            isDeploymentId(event.rollbackDeploymentId) &&
            event.rollbackDeploymentId !== context.productionDeploymentId,
          target: 'rollbackInProgress',
        },
      },
    },

    rollbackInProgress: step(
      'Przełącz aplikację, sprawdź domeny i smoke; baza pozostaje bez zmian.',
      'rolledBack',
      'reconciliationRequired',
    ),

    rolledBack: {
      type: 'final',
      description: 'Kod cofnięty. Uzgodnij rejestr aktywnej wersji; nie cofaj baseline schematu automatycznie.',
    },

    abandoned: {
      type: 'final',
      description: 'Kandydat porzucony. Nie oznacza cofnięcia migracji ani innych skutków.',
    },
  },
})
