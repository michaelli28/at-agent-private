import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || 'AT Agent <notifications@yourdomain.com>';

export interface FailedTestNotificationData {
  projectName: string;
  jobName?: string;
  buildNumber?: string;
  buildUrl?: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passRate: number;
  dashboardUrl: string;
  testRunId: string;
}

export interface WeeklySummaryData {
  projectName: string;
  totalRuns: number;
  totalTests: number;
  averagePassRate: number;
  totalViolations: number;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
  dashboardUrl: string;
}

export async function sendFailedTestNotification(
  to: string,
  data: FailedTestNotificationData
): Promise<{ success: boolean; error?: string }> {
  try {
    const subject = `[AT Agent] Test Failures: ${data.projectName}${data.jobName ? ` - ${data.jobName}` : ''} (${data.failedTests} failed)`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Failure Notification</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 24px;">Test Failures Detected</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">${data.projectName}${data.jobName ? ` - ${data.jobName}` : ''}</p>
  </div>

  <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
    <div style="display: flex; justify-content: space-around; text-align: center; margin-bottom: 30px;">
      <div style="flex: 1;">
        <div style="font-size: 36px; font-weight: bold; color: #333;">${data.totalTests}</div>
        <div style="color: #6c757d; font-size: 14px;">Total Tests</div>
      </div>
      <div style="flex: 1;">
        <div style="font-size: 36px; font-weight: bold; color: #28a745;">${data.passedTests}</div>
        <div style="color: #6c757d; font-size: 14px;">Passed</div>
      </div>
      <div style="flex: 1;">
        <div style="font-size: 36px; font-weight: bold; color: #dc3545;">${data.failedTests}</div>
        <div style="color: #6c757d; font-size: 14px;">Failed</div>
      </div>
    </div>

    <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <span style="color: #6c757d;">Pass Rate</span>
        <span style="font-weight: bold; color: ${data.passRate >= 80 ? '#28a745' : data.passRate >= 50 ? '#ffc107' : '#dc3545'};">${data.passRate.toFixed(1)}%</span>
      </div>
      <div style="background: #e9ecef; border-radius: 4px; height: 8px; overflow: hidden;">
        <div style="background: ${data.passRate >= 80 ? '#28a745' : data.passRate >= 50 ? '#ffc107' : '#dc3545'}; height: 100%; width: ${data.passRate}%;"></div>
      </div>
    </div>

    ${data.buildNumber ? `
    <div style="background: white; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
      <p style="margin: 0; color: #6c757d; font-size: 14px;">
        Build #${data.buildNumber}
        ${data.buildUrl ? ` - <a href="${data.buildUrl}" style="color: #007bff;">View Build</a>` : ''}
      </p>
    </div>
    ` : ''}

    <a href="${data.dashboardUrl}/runs/${data.testRunId}" style="display: block; background: #007bff; color: white; text-align: center; padding: 15px 30px; border-radius: 8px; text-decoration: none; font-weight: 600;">
      View Full Results
    </a>
  </div>

  <div style="text-align: center; padding: 20px; color: #6c757d; font-size: 12px;">
    <p>You're receiving this because you enabled email notifications for failed tests.</p>
    <p>Manage your notification settings in the <a href="${data.dashboardUrl}/settings" style="color: #007bff;">dashboard settings</a>.</p>
  </div>
</body>
</html>
    `;

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Failed to send email:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error sending failed test notification:', error);
    return { success: false, error: error.message };
  }
}

export async function sendWeeklySummary(
  to: string,
  summaries: WeeklySummaryData[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const subject = `[AT Agent] Weekly Accessibility Test Summary`;

    const projectRows = summaries.map(s => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e9ecef; font-weight: 500;">${s.projectName}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: center;">${s.totalRuns}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: center;">${s.totalTests}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: center;">
          <span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; background: ${s.averagePassRate >= 80 ? '#d4edda' : s.averagePassRate >= 50 ? '#fff3cd' : '#f8d7da'}; color: ${s.averagePassRate >= 80 ? '#155724' : s.averagePassRate >= 50 ? '#856404' : '#721c24'};">
            ${s.averagePassRate.toFixed(1)}%
          </span>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: center; color: ${s.totalViolations > 0 ? '#dc3545' : '#28a745'};">${s.totalViolations}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: center;">
          ${s.trend === 'up' ? '<span style="color: #28a745;">&#9650;</span>' : s.trend === 'down' ? '<span style="color: #dc3545;">&#9660;</span>' : '<span style="color: #6c757d;">&#8212;</span>'}
          ${Math.abs(s.trendPercentage).toFixed(1)}%
        </td>
      </tr>
    `).join('');

    const overallPassRate = summaries.length > 0
      ? summaries.reduce((sum, s) => sum + s.averagePassRate, 0) / summaries.length
      : 0;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Summary</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="margin: 0; font-size: 24px;">Weekly Accessibility Report</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">Summary for the past 7 days</p>
  </div>

  <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
    <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; text-align: center;">
      <div style="font-size: 14px; color: #6c757d; margin-bottom: 5px;">Overall Pass Rate</div>
      <div style="font-size: 48px; font-weight: bold; color: ${overallPassRate >= 80 ? '#28a745' : overallPassRate >= 50 ? '#ffc107' : '#dc3545'};">${overallPassRate.toFixed(1)}%</div>
    </div>

    <div style="background: white; border-radius: 8px; overflow: hidden;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f8f9fa;">
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #333;">Project</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #333;">Runs</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #333;">Tests</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #333;">Pass Rate</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #333;">Violations</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #333;">Trend</th>
          </tr>
        </thead>
        <tbody>
          ${projectRows}
        </tbody>
      </table>
    </div>

    <div style="margin-top: 20px; text-align: center;">
      <a href="${summaries[0]?.dashboardUrl || '#'}/trends" style="display: inline-block; background: #007bff; color: white; padding: 15px 30px; border-radius: 8px; text-decoration: none; font-weight: 600;">
        View Detailed Trends
      </a>
    </div>
  </div>

  <div style="text-align: center; padding: 20px; color: #6c757d; font-size: 12px;">
    <p>You're receiving this weekly summary because you enabled it in your settings.</p>
    <p>Manage your notification settings in the <a href="${summaries[0]?.dashboardUrl || '#'}/settings" style="color: #007bff;">dashboard settings</a>.</p>
  </div>
</body>
</html>
    `;

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Failed to send weekly summary:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error sending weekly summary:', error);
    return { success: false, error: error.message };
  }
}
