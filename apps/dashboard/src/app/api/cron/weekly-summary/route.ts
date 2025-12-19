import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendWeeklySummary, WeeklySummaryData } from '@/lib/email';
import { subDays } from 'date-fns';

// This endpoint should be called by a cron job (e.g., Vercel Cron, GitHub Actions)
// Schedule: Every Monday at 9:00 AM
// Cron expression: 0 9 * * 1

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[Weekly Summary] Starting weekly summary job');

    // Get all users who have weekly reports enabled
    const settingsQuery = await adminDb
      .collection('userSettings')
      .where('weeklyReportsEnabled', '==', true)
      .get();

    if (settingsQuery.empty) {
      console.log('[Weekly Summary] No users have weekly reports enabled');
      return NextResponse.json({
        success: true,
        message: 'No users with weekly reports enabled',
        emailsSent: 0,
      });
    }

    const oneWeekAgo = subDays(new Date(), 7);
    let emailsSent = 0;
    let errors: string[] = [];

    for (const settingsDoc of settingsQuery.docs) {
      const settings = settingsDoc.data();
      const userId = settings.userId;

      if (!settings.notificationEmail) {
        console.log(`[Weekly Summary] User ${userId} has no notification email, skipping`);
        continue;
      }

      try {
        // Get projects owned by this user
        const projectsQuery = await adminDb
          .collection('projects')
          .where('ownerId', '==', userId)
          .get();

        if (projectsQuery.empty) {
          console.log(`[Weekly Summary] User ${userId} has no projects, skipping`);
          continue;
        }

        const summaries: WeeklySummaryData[] = [];
        const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        for (const projectDoc of projectsQuery.docs) {
          const project = projectDoc.data();
          const projectId = projectDoc.id;

          // Get test runs from the last week for this project
          const runsQuery = await adminDb
            .collection('testRuns')
            .where('projectId', '==', projectId)
            .where('createdAt', '>=', oneWeekAgo)
            .get();

          if (runsQuery.empty) {
            continue;
          }

          // Calculate stats for this project
          let totalRuns = runsQuery.docs.length;
          let totalTests = 0;
          let totalPassed = 0;
          let totalViolations = 0;

          runsQuery.docs.forEach(runDoc => {
            const run = runDoc.data();
            totalTests += run.totalTests || 0;
            totalPassed += run.passedTests || 0;
            totalViolations += run.totalViolations || 0;
          });

          const averagePassRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

          // Calculate trend (compare to previous week)
          const twoWeeksAgo = subDays(new Date(), 14);
          const previousWeekRunsQuery = await adminDb
            .collection('testRuns')
            .where('projectId', '==', projectId)
            .where('createdAt', '>=', twoWeeksAgo)
            .where('createdAt', '<', oneWeekAgo)
            .get();

          let trend: 'up' | 'down' | 'stable' = 'stable';
          let trendPercentage = 0;

          if (!previousWeekRunsQuery.empty) {
            let prevTotalTests = 0;
            let prevTotalPassed = 0;

            previousWeekRunsQuery.docs.forEach(runDoc => {
              const run = runDoc.data();
              prevTotalTests += run.totalTests || 0;
              prevTotalPassed += run.passedTests || 0;
            });

            const prevPassRate = prevTotalTests > 0 ? (prevTotalPassed / prevTotalTests) * 100 : 0;
            trendPercentage = averagePassRate - prevPassRate;

            if (trendPercentage > 1) {
              trend = 'up';
            } else if (trendPercentage < -1) {
              trend = 'down';
            }
          }

          summaries.push({
            projectName: project.name,
            totalRuns,
            totalTests,
            averagePassRate,
            totalViolations,
            trend,
            trendPercentage,
            dashboardUrl,
          });
        }

        if (summaries.length === 0) {
          console.log(`[Weekly Summary] User ${userId} has no test runs this week, skipping`);
          continue;
        }

        // Send the weekly summary email
        console.log(`[Weekly Summary] Sending summary to ${settings.notificationEmail} with ${summaries.length} projects`);
        const result = await sendWeeklySummary(settings.notificationEmail, summaries);

        if (result.success) {
          emailsSent++;
          console.log(`[Weekly Summary] Successfully sent to ${settings.notificationEmail}`);
        } else {
          errors.push(`Failed to send to ${settings.notificationEmail}: ${result.error}`);
          console.error(`[Weekly Summary] Failed to send to ${settings.notificationEmail}:`, result.error);
        }
      } catch (userError: any) {
        errors.push(`Error processing user ${userId}: ${userError.message}`);
        console.error(`[Weekly Summary] Error processing user ${userId}:`, userError);
      }
    }

    console.log(`[Weekly Summary] Job completed. Emails sent: ${emailsSent}, Errors: ${errors.length}`);

    return NextResponse.json({
      success: true,
      emailsSent,
      totalUsers: settingsQuery.docs.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('[Weekly Summary] Job failed:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// Also allow POST for flexibility with different cron services
export async function POST(request: NextRequest) {
  return GET(request);
}
