/** Shared test fixtures */

/** Trimmed but structurally faithful processstage.clientdata document */
export const SAMPLE_CLIENT_DATA = JSON.stringify({
  __class: 'StageStep:#Microsoft.Crm.Workflow.ObjectModel',
  description: 'Qualify',
  name: 'Qualify',
  stageId: '6b9ce83d-3e9b-4f8b-b2c4-7e0c0c0e5e01',
  steps: {
    __class: 'ActivityCollection:#Microsoft.Crm.Workflow.ObjectModel',
    list: [
      {
        __class: 'StepStep:#Microsoft.Crm.Workflow.ObjectModel',
        description: 'Existing Contact?',
        isProcessRequired: false,
        steps: {
          __class: 'ActivityCollection:#Microsoft.Crm.Workflow.ObjectModel',
          list: [
            {
              __class: 'ControlStep:#Microsoft.Crm.Workflow.ObjectModel',
              controlDisplayName: 'Existing Contact?',
              controlId: 'parentcontactid',
              dataFieldName: 'parentcontactid',
            },
          ],
        },
      },
      {
        __class: 'StepStep:#Microsoft.Crm.Workflow.ObjectModel',
        description: 'Est. Budget',
        isProcessRequired: true,
        steps: {
          list: [
            {
              __class: 'ControlStep:#Microsoft.Crm.Workflow.ObjectModel',
              controlDisplayName: '',
              dataFieldName: 'budgetamount',
            },
          ],
        },
      },
      {
        __class: 'StepStep:#Microsoft.Crm.Workflow.ObjectModel',
        description: 'Purchase Timeframe',
        isProcessRequired: true,
        steps: { list: [{ __class: 'ControlStep:#Microsoft.Crm.Workflow.ObjectModel', dataFieldName: 'purchasetimeframe' }] },
      },
    ],
  },
});

// ---------------------------------------------------------------------------
// SYNTHETIC process definition (workflow.clientdata) — structurally modeled on
// a real multi-entity BPF; ids and field names are made up. Stages sit under
// entity steps (and one under a condition branch), not at the top level.
// ---------------------------------------------------------------------------

const control = (dataFieldName: string, controlDisplayName = '') => ({
  __class: 'ControlStep:#Microsoft.Crm.Workflow.ObjectModel',
  controlId: dataFieldName,
  controlDisplayName,
  dataFieldName,
  isHidden: false,
});
const stepStep = (description: string, ctrl: object, isProcessRequired = false) => ({
  __class: 'StepStep:#Microsoft.Crm.Workflow.ObjectModel',
  description,
  isProcessRequired,
  steps: { __class: 'ActivityCollection:#Microsoft.Crm.Workflow.ObjectModel', list: [ctrl] },
});
const stage = (stageId: string, description: string, list: object[]) => ({
  __class: 'StageStep:#Microsoft.Crm.Workflow.ObjectModel',
  stageId,
  nextStageId: null,
  description,
  steps: { __class: 'ActivityCollection:#Microsoft.Crm.Workflow.ObjectModel', list },
});

/** The stage whose six fields the tests check (written here with braces + upper case) */
export const SYNTH_STAGE_ID = '7a1d6f0e-3c2b-4e8a-9b55-0c4d2e9f1a63';

export const SYNTHETIC_PROCESS_DEFINITION = JSON.stringify({
  __class: 'WorkflowStep:#Microsoft.Crm.Workflow.ObjectModel',
  id: 'root',
  steps: {
    __class: 'ActivityCollection:#Microsoft.Crm.Workflow.ObjectModel',
    list: [
      {
        __class: 'EntityStep:#Microsoft.Crm.Workflow.ObjectModel',
        description: 'Lead',
        steps: {
          list: [
            stage('11111111-1111-4111-8111-111111111111', 'Identify', [stepStep('Topic', control('subject', 'Topic'), true)]),
            stage('22222222-2222-4222-8222-222222222222', 'Screen', [stepStep('Phone', control('telephone1'))]),
          ],
        },
      },
      {
        __class: 'EntityStep:#Microsoft.Crm.Workflow.ObjectModel',
        description: 'Opportunity',
        steps: {
          list: [
            stage('33333333-3333-4333-8333-333333333333', 'Interview', [stepStep('Interviewed', control('x_interviewed'))]),
            stage(`{${SYNTH_STAGE_ID.toUpperCase()}}`, 'Offer', [
              stepStep('Offer letter sent', control('x_offerlettersent', 'Offer Letter Sent'), true),
              stepStep('Transition assistance', control('x_transitionassistance')),
              stepStep('Approved TA amount', control('x_approvedtaamount', 'Approved TA Amount'), true),
              // A step that binds no field (e.g. an action step): not a field
              { __class: 'StepStep:#Microsoft.Crm.Workflow.ObjectModel', description: 'Run approval', steps: { list: [] } },
              control('x_taterm', 'TA Term'), // bare ControlStep outside a StepStep
              stepStep('IPO units', control('x_ipounits')),
              stepStep('Offer letter sent (again)', control('x_offerlettersent')), // duplicate: listed once
              stepStep('Start date', control('x_startdate', 'Start Date')),
            ]),
            stage('55555555-5555-4555-8555-555555555555', 'Onboard', [stepStep('Badge', control('x_badge'))]),
            {
              __class: 'ConditionStep:#Microsoft.Crm.Workflow.ObjectModel',
              description: 'Branch: experienced hire?',
              steps: {
                list: [
                  stage('66666666-6666-4666-8666-666666666666', 'Licensing', [stepStep('License', control('x_license'))]),
                  stage('77777777-7777-4777-8777-777777777777', 'Close', [stepStep('Closed', control('x_closed'))]),
                ],
              },
            },
          ],
        },
      },
    ],
  },
});
