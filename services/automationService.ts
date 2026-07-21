export interface AutomationRun {
  id: number;
  runDate: string;
  messageId: string;
  subject: string;
  fromAddress: string;
  fileName: string;
  itemCount: number;
  status: 'processed' | 'skipped' | 'error';
  drivePdfLink?: string | null;
  driveCsvLink?: string | null;
  error?: string | null;
  createdAt: string;
}

export const fetchAutomationRuns = async (): Promise<AutomationRun[]> => {
  const response = await fetch('/api/automation-runs');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load automation history (status ${response.status})`);
  }
  const { runs } = await response.json();
  return runs;
};
