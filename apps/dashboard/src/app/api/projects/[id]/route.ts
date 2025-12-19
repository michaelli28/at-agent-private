import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

interface DeleteResponse {
  success: boolean;
  deletedTestRuns?: number;
  deletedTestResults?: number;
  error?: string;
}

// DELETE /api/projects/[id] - Delete a project and all associated data
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id;

    if (!projectId) {
      return NextResponse.json<DeleteResponse>(
        { success: false, error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Check if project exists
    const projectRef = adminDb.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      return NextResponse.json<DeleteResponse>(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    // Get all test runs for this project
    const testRunsQuery = await adminDb
      .collection('testRuns')
      .where('projectId', '==', projectId)
      .get();

    const testRunIds = testRunsQuery.docs.map(doc => doc.id);
    let deletedTestResults = 0;

    // Delete test results for each test run
    // Need to batch delete to avoid Firestore limits
    const batchSize = 500;

    for (const testRunId of testRunIds) {
      const resultsQuery = await adminDb
        .collection('testResults')
        .where('testRunId', '==', testRunId)
        .get();

      // Delete in batches
      const resultDocs = resultsQuery.docs;
      for (let i = 0; i < resultDocs.length; i += batchSize) {
        const batch = adminDb.batch();
        const batchDocs = resultDocs.slice(i, i + batchSize);

        for (const doc of batchDocs) {
          batch.delete(doc.ref);
        }

        await batch.commit();
        deletedTestResults += batchDocs.length;
      }
    }

    // Delete all test runs
    const deletedTestRuns = testRunsQuery.docs.length;
    for (let i = 0; i < testRunsQuery.docs.length; i += batchSize) {
      const batch = adminDb.batch();
      const batchDocs = testRunsQuery.docs.slice(i, i + batchSize);

      for (const doc of batchDocs) {
        batch.delete(doc.ref);
      }

      await batch.commit();
    }

    // Delete the project itself
    await projectRef.delete();

    console.log(`Deleted project ${projectId}: ${deletedTestRuns} test runs, ${deletedTestResults} test results`);

    return NextResponse.json<DeleteResponse>({
      success: true,
      deletedTestRuns,
      deletedTestResults,
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json<DeleteResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/projects/[id] - Get project details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'Project ID is required' },
        { status: 400 }
      );
    }

    const projectRef = adminDb.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      project: {
        id: projectDoc.id,
        ...projectDoc.data(),
      },
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
