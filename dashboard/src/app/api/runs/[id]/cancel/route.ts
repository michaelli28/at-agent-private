import { NextRequest, NextResponse } from 'next/server';
import adminApp, { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/**
 * POST /api/runs/[id]/cancel
 * Cancels a running test run.
 * Requires user authentication via Firebase ID token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const runId = params.id;

    // Get Authorization header
    const authHeader = request.headers.get('Authorization');
    const idToken = authHeader?.replace('Bearer ', '');

    if (!idToken) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify the ID token
    let userId: string;
    try {
      const decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
      userId = decodedToken.uid;
    } catch (error) {
      console.error('Token verification error:', error);
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get the test run
    const runRef = adminDb.collection('testRuns').doc(runId);
    const runDoc = await runRef.get();

    if (!runDoc.exists) {
      return NextResponse.json(
        { error: 'Test run not found' },
        { status: 404 }
      );
    }

    const runData = runDoc.data()!;

    // Get the project to verify ownership
    const projectRef = adminDb.collection('projects').doc(runData.projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const projectData = projectDoc.data()!;

    // Verify user owns the project
    if (projectData.ownerId !== userId) {
      return NextResponse.json(
        { error: 'Not authorized to cancel this test run' },
        { status: 403 }
      );
    }

    // Check if the run is in a cancellable state
    if (runData.status !== 'running' && runData.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot cancel a test run with status '${runData.status}'` },
        { status: 400 }
      );
    }

    // Update the test run status to cancelled
    await runRef.update({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: userId,
    });

    // Update any pending rerun jobs for this test run
    const rerunJobsQuery = await adminDb
      .collection('rerunJobs')
      .where('testRunId', '==', runId)
      .where('status', 'in', ['pending', 'running'])
      .get();

    const batch = adminDb.batch();
    rerunJobsQuery.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    // Update live status to show cancellation
    const liveStatusRef = adminDb.collection('liveStatus').doc(runId);
    const liveStatusDoc = await liveStatusRef.get();
    if (liveStatusDoc.exists) {
      await liveStatusRef.update({
        isRunning: false,
        isCancelled: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Test run cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling test run:', error);
    return NextResponse.json(
      { error: 'Failed to cancel test run' },
      { status: 500 }
    );
  }
}
