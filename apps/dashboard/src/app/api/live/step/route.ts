import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/live/step
 * Records a single step during live test execution.
 * Called by the agent after each action.
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
      testIndex,
      url,
      goal,
      stepNumber,
      action,
      observation,
      thought,
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

    // Add the live step to Firestore
    const liveStepRef = adminDb.collection('liveSteps').doc();
    await liveStepRef.set({
      testRunId,
      testIndex: testIndex ?? 0,
      url: url || '',
      goal: goal || '',
      stepNumber: stepNumber ?? 1,
      action: action || '',
      observation: observation || '',
      thought: thought || '',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Update the live status
    const liveStatusRef = adminDb.collection('liveStatus').doc(testRunId);
    await liveStatusRef.update({
      currentTestIndex: testIndex ?? 0,
      currentTestUrl: url || '',
      currentTestGoal: goal || '',
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      stepId: liveStepRef.id,
    });
  } catch (error) {
    console.error('Error recording live step:', error);
    return NextResponse.json(
      { error: 'Failed to record step' },
      { status: 500 }
    );
  }
}
