'use client';

import { useState, useEffect } from 'react';
import { Save, Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { UserSettings } from '@/types';

type SettingsForm = Omit<UserSettings, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

const DEFAULT_SETTINGS: SettingsForm = {
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

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SettingsForm>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchSettings();
    }
  }, [user]);

  async function fetchSettings() {
    try {
      setLoading(true);
      const response = await fetch(`/api/settings?userId=${user?.uid}`);
      const data = await response.json();

      if (data.success && data.settings) {
        const { id, userId, createdAt, updatedAt, ...settingsData } = data.settings;
        setSettings({ ...DEFAULT_SETTINGS, ...settingsData });
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!user) return;

    // Validate email if notifications are enabled
    if ((settings.emailNotificationsEnabled || settings.weeklyReportsEnabled) && !settings.notificationEmail) {
      setError('Please enter a notification email address');
      return;
    }

    if (settings.notificationEmail && !isValidEmail(settings.notificationEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          ...settings,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError(data.error || 'Failed to save settings');
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function updateSetting<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setError(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Configure your dashboard preferences</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-danger-50 border border-danger-200 rounded-lg text-danger-700">
          {error}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold">General Settings</h2>
        </div>
        <div className="card-body space-y-6">
          <div>
            <label className="label">Dashboard Name</label>
            <input
              type="text"
              className="input"
              value={settings.dashboardName}
              onChange={(e) => updateSetting('dashboardName', e.target.value)}
              placeholder="My Dashboard"
            />
            <p className="text-sm text-gray-500 mt-1">
              The name displayed in the sidebar and browser tab
            </p>
          </div>

          <div>
            <label className="label">Default Time Range</label>
            <select
              className="input"
              value={settings.defaultTimeRange}
              onChange={(e) => updateSetting('defaultTimeRange', Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <p className="text-sm text-gray-500 mt-1">
              Default time range for trends and analytics
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                className="w-4 h-4 text-primary-600 rounded"
                checked={settings.autoExpandFailedTests}
                onChange={(e) => updateSetting('autoExpandFailedTests', e.target.checked)}
              />
              <span className="text-sm text-gray-700">Auto-expand failed test results</span>
            </label>
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Notifications</h2>
        </div>
        <div className="card-body space-y-4">
          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                className="w-4 h-4 text-primary-600 rounded"
                checked={settings.emailNotificationsEnabled}
                onChange={(e) => updateSetting('emailNotificationsEnabled', e.target.checked)}
              />
              <span className="text-sm text-gray-700">Email notifications for failed tests</span>
            </label>
            <p className="text-sm text-gray-500 mt-1 ml-7">
              Receive an email when a test run has failures
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                className="w-4 h-4 text-primary-600 rounded"
                checked={settings.weeklyReportsEnabled}
                onChange={(e) => updateSetting('weeklyReportsEnabled', e.target.checked)}
              />
              <span className="text-sm text-gray-700">Weekly summary reports</span>
            </label>
            <p className="text-sm text-gray-500 mt-1 ml-7">
              Receive a weekly summary of all test results every Monday
            </p>
          </div>

          <div>
            <label className="label">Notification Email</label>
            <input
              type="email"
              className="input"
              value={settings.notificationEmail}
              onChange={(e) => updateSetting('notificationEmail', e.target.value)}
              placeholder="team@example.com"
            />
            <p className="text-sm text-gray-500 mt-1">
              Email address for notifications (required if notifications are enabled)
            </p>
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Pass Rate Thresholds</h2>
        </div>
        <div className="card-body space-y-4">
          <div>
            <label className="label">Good (Green)</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                className="input w-24"
                value={settings.goodPassRateThreshold}
                onChange={(e) => updateSetting('goodPassRateThreshold', Number(e.target.value))}
                min="0"
                max="100"
              />
              <span className="text-gray-500">% and above</span>
            </div>
          </div>

          <div>
            <label className="label">Warning (Yellow)</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                className="input w-24"
                value={settings.warningPassRateThreshold}
                onChange={(e) => updateSetting('warningPassRateThreshold', Number(e.target.value))}
                min="0"
                max="100"
              />
              <span className="text-gray-500">% to {settings.goodPassRateThreshold - 1}%</span>
            </div>
          </div>

          <p className="text-sm text-gray-500">
            Pass rates below the warning threshold will be shown in red.
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Saving...
            </>
          ) : saved ? (
            <>
              <Check className="w-5 h-5 mr-2" />
              Saved
            </>
          ) : (
            <>
              <Save className="w-5 h-5 mr-2" />
              Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}
