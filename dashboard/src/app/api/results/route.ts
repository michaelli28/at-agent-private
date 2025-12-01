import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { SubmitResultsRequest, SubmitResultsResponse } from '@/types';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(request: NextRequest) {
  try {
    // Get API key from header
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key');

    if (!apiKey) {
      return NextResponse.json<SubmitResultsResponse>(
        { success: false, error: 'Missing API key' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: SubmitResultsRequest = await request.json();

    // Validate required fields
    if (!body.results || !Array.isArray(body.results)) {
      return NextResponse.json<SubmitResultsResponse>(
        { success: false, error: 'Missing or invalid results array' },
        { status: 400 }
      );
    }

    // Find project by API key
    const projectsRef = adminDb.collection('projects');
    const projectQuery = await projectsRef.where('apiKey', '==', apiKey).limit(1).get();

    if (projectQuery.empty) {
      return NextResponse.json<SubmitResultsResponse>(
        { success: false, error: 'Invalid API key' },
        { status: 401 }
      );
    }

    const projectDoc = projectQuery.docs[0];
    const projectId = projectDoc.id;

    // Calculate aggregates
    const totalTests = body.results.length;
    const passedTests = body.results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    const passRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
    const totalViolations = body.results.reduce((sum, r) => sum + (r.violations?.length || 0), 0);

    // Create test run document
    const testRunRef = adminDb.collection('testRuns').doc();
    const testRunData = {
      projectId,
      platform: body.platform || 'other',
      buildNumber: body.buildNumber || null,
      buildUrl: body.buildUrl || null,
      branch: body.branch || null,
      commit: body.commit || null,
      totalTests,
      passedTests,
      failedTests,
      passRate,
      totalDuration: body.totalDuration || 0,
      totalViolations,
      status: 'completed',
      createdAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
      metadata: body.metadata || null,
    };

    await testRunRef.set(testRunData);

    // Create test result documents
    const batch = adminDb.batch();
    const resultsRef = adminDb.collection('testResults');

    for (const result of body.results) {
      const resultDoc = resultsRef.doc();
      batch.set(resultDoc, {
        testRunId: testRunRef.id,
        projectId,
        url: result.url,
        goal: result.goal,
        success: result.success,
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

    // Update project's updatedAt timestamp
    await projectDoc.ref.update({
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json<SubmitResultsResponse>({
      success: true,
      testRunId: testRunRef.id,
    });
  } catch (error) {
    console.error('Error submitting results:', error);
    return NextResponse.json<SubmitResultsResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}
