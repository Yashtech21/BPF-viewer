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
