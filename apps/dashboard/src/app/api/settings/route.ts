import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { UserSettings } from '@/types';

const DEFAULT_SETTINGS: Omit<UserSettings, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
  dashboardName: 'AT Agent Dashboard',
  defaultTimeRange: 30,
  showViolationsInSummary: true,
  autoExpandFailedTests: true,
  emailNotificationsEnabled: false,
  weeklyReportsEnabled: false,
  notificationEmail: '',
  goodPassRateThreshold: 80,
  warningPassRateThreshold: 50,
};

// GET /api/settings?userId=xxx - Get user settings
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    // Try to find existing settings
    const settingsQuery = await adminDb
      .collection('userSettings')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (settingsQuery.empty) {
      // Return default settings (not saved yet)
      return NextResponse.json({
        success: true,
        settings: {
          ...DEFAULT_SETTINGS,
          userId,
        },
        isDefault: true,
      });
    }

    const settingsDoc = settingsQuery.docs[0];
    const settings = {
      id: settingsDoc.id,
      ...settingsDoc.data(),
    };

    return NextResponse.json({
      success: true,
      settings,
      isDefault: false,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/settings - Create or update user settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, ...settingsData } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    // Find existing settings
    const settingsQuery = await adminDb
      .collection('userSettings')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    const settingsToSave = {
      ...DEFAULT_SETTINGS,
      ...settingsData,
      userId,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (settingsQuery.empty) {
      // Create new settings
      const newDoc = adminDb.collection('userSettings').doc();
      await newDoc.set({
        ...settingsToSave,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        success: true,
        settingsId: newDoc.id,
        message: 'Settings created',
      });
    } else {
      // Update existing settings
      const existingDoc = settingsQuery.docs[0];
      await existingDoc.ref.update(settingsToSave);

      return NextResponse.json({
        success: true,
        settingsId: existingDoc.id,
        message: 'Settings updated',
      });
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
