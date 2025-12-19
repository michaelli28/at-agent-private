import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendFailedTestNotification } from '@/lib/email';

/**
 * POST /api/live/complete
 * Completes a live test run with final results.
 * Called at the end of all tests.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key');

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      testRunId,
      results, // Final results array
      totalDuration,
    } = body;

    if (!testRunId) {
      return NextResponse.json(
        { error: 'testRunId required' },
        { status: 400 }
      );
    }

    // Verify the test run exists and API key matches
    const testRunRef = adminDb.collection('testRuns').doc(testRunId);
    const testRunDoc = await testRunRef.get();

    if (!testRunDoc.exists) {
      return NextResponse.json(
        { error: 'Test run not found' },
        { status: 404 }
      );
    }

    const testRunData = testRunDoc.data()!;

    // Verify API key matches the project
    const projectRef = adminDb.collection('projects').doc(testRunData.projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists || projectDoc.data()?.apiKey !== apiKey) {
      return NextResponse.json(
        { error: 'Invalid API key for this test run' },
        { status: 401 }
      );
    }

    const projectData = projectDoc.data()!;

    // Calculate stats from results
    const totalTests = results?.length || 0;
    const passedTests = results?.filter((r: any) => r.success).length || 0;
    const failedTests = totalTests - passedTests;
    const passRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
    const totalViolations = results?.reduce(
      (sum: number, r: any) => sum + (r.violations?.length || 0),
      0
    ) || 0;

    // Update the test run with final stats
    await testRunRef.update({
      totalTests,
      passedTests,
      failedTests,
      passRate,
      totalDuration: totalDuration || 0,
      totalViolations,
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
    });

    // Create individual test result documents
    const batch = adminDb.batch();
    for (const result of results || []) {
      const resultRef = adminDb.collection('testResults').doc();
      batch.set(resultRef, {
        testRunId,
        projectId: testRunData.projectId,
        url: result.url || '',
        goal: result.goal || '',
        success: result.success || false,
        reason: result.reason || null,
        error: result.error || null,
        stepCount: result.steps?.length || 0,
        steps: result.steps || [],
        violations: result.violations || [],
        duration: result.duration || 0,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    // Update live status to complete
    const liveStatusRef = adminDb.collection('liveStatus').doc(testRunId);
    await liveStatusRef.update({
      isRunning: false,
      completedTests: totalTests,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Clean up live steps (optional - keep for debugging or delete)
    // For now, we'll keep them but you could delete them here

    // Update project's updatedAt
    await projectRef.update({
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Send email notification if there are failures
    if (failedTests > 0 && projectData.ownerId) {
      try {
        const settingsQuery = await adminDb
          .collection('userSettings')
          .where('userId', '==', projectData.ownerId)
          .limit(1)
          .get();

        if (!settingsQuery.empty) {
          const settings = settingsQuery.docs[0].data();
          if (settings.emailNotificationsEnabled && settings.notificationEmail) {
            const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
            await sendFailedTestNotification(settings.notificationEmail, {
              projectName: projectData.name,
              testRunId,
              totalTests,
              passedTests,
              failedTests,
              passRate,
              buildNumber: testRunData.buildNumber,
              buildUrl: testRunData.buildUrl,
              dashboardUrl,
            });
          }
        }
      } catch (emailError) {
        console.error('Error sending notification email:', emailError);
      }
    }

    return NextResponse.json({
      success: true,
      testRunId,
      projectName: projectData.name,
      stats: {
        totalTests,
        passedTests,
        failedTests,
        passRate,
        totalViolations,
      },
    });
  } catch (error) {
    console.error('Error completing live run:', error);
    return NextResponse.json(
      { error: 'Failed to complete run' },
      { status: 500 }
    );
  }
}
