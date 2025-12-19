import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/rerun/status?jobId=xxx
 * Get the status of a rerun job.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required' },
        { status: 400 }
      );
    }

    const jobRef = adminDb.collection('rerunJobs').doc(jobId);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) {
      return NextResponse.json(
        { error: 'Rerun job not found' },
        { status: 404 }
      );
    }

    const jobData = jobDoc.data()!;

    // Get the live status for completed tests count
    const liveStatusRef = adminDb.collection('liveStatus').doc(jobData.testRunId);
    const liveStatusDoc = await liveStatusRef.get();
    const liveStatusData = liveStatusDoc.exists ? liveStatusDoc.data() : null;

    return NextResponse.json({
      jobId,
      status: jobData.status,
      testRunId: jobData.testRunId,
      totalTests: jobData.tests?.length || 0,
      completedTests: liveStatusData?.completedTests || 0,
      passedTests: liveStatusData?.passedTests || 0,
      failedTests: liveStatusData?.failedTests || 0,
      error: jobData.error || null,
      createdAt: jobData.createdAt?.toDate?.() || null,
      startedAt: jobData.startedAt?.toDate?.() || null,
      completedAt: jobData.completedAt?.toDate?.() || null,
    });
  } catch (error) {
    console.error('Error getting rerun status:', error);
    return NextResponse.json(
      { error: 'Failed to get rerun status' },
      { status: 500 }
    );
  }
}
