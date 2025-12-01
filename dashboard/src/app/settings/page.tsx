'use client';

import { useState } from 'react';
import { Settings, Save, Check } from 'lucide-react';

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Configure your dashboard preferences</p>
      </div>

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
              defaultValue="Accessibility Dashboard"
              placeholder="My Dashboard"
            />
            <p className="text-sm text-gray-500 mt-1">
              The name displayed in the sidebar and browser tab
            </p>
          </div>

          <div>
            <label className="label">Default Time Range</label>
            <select className="input" defaultValue="30">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <p className="text-sm text-gray-500 mt-1">
              Default time range for trends and analytics
            </p>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" className="w-4 h-4 text-primary-600 rounded" defaultChecked />
              <span className="text-sm text-gray-700">Show violations in summary cards</span>
            </label>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" className="w-4 h-4 text-primary-600 rounded" defaultChecked />
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
              <input type="checkbox" className="w-4 h-4 text-primary-600 rounded" />
              <span className="text-sm text-gray-700">Email notifications for failed tests</span>
            </label>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input type="checkbox" className="w-4 h-4 text-primary-600 rounded" />
              <span className="text-sm text-gray-700">Weekly summary reports</span>
            </label>
          </div>

          <div>
            <label className="label">Notification Email</label>
            <input
              type="email"
              className="input"
              placeholder="team@example.com"
            />
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
                defaultValue="80"
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
                defaultValue="50"
                min="0"
                max="100"
              />
              <span className="text-gray-500">% to 79%</span>
            </div>
          </div>

          <p className="text-sm text-gray-500">
            Pass rates below the warning threshold will be shown in red.
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button onClick={handleSave} className="btn btn-primary">
          {saved ? (
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
