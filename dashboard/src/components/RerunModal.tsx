'use client';

import { useState } from 'react';
import { X, RefreshCw, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface RerunTest {
  index: number;
  url: string;
  goal: string;
  success: boolean;
}

interface RerunModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTests: RerunTest[];
  originalTestRunId: string;
  onRerunStarted: (testRunId: string) => void;
}

export default function RerunModal({
  isOpen,
  onClose,
  selectedTests,
  originalTestRunId,
  onRerunStarted,
}: RerunModalProps) {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ testRunId: string } | null>(null);

  if (!isOpen) return null;

  const handleRerun = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Get the Firebase ID token
      if (!user) {
        throw new Error('User not logged in');
      }

      const idToken = await user.getIdToken();

      if (!idToken) {
        throw new Error('Failed to get authentication token');
      }

      const response = await fetch('/api/rerun/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          originalTestRunId,
          testIndices: selectedTests.map(t => t.index),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start rerun');
      }

      setSuccess({ testRunId: data.testRunId });
      onRerunStarted(data.testRunId);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setSuccess(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <RefreshCw className="w-5 h-5 text-primary-600" />
              <h2 className="text-lg font-semibold text-gray-900">Rerun Tests</h2>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 overflow-y-auto max-h-[50vh]">
            {success ? (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-success-500 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Rerun Started!
                </h3>
                <p className="text-gray-600 mb-4">
                  Your tests are now running. You'll be redirected to the new test run.
                </p>
              </div>
            ) : (
              <>
                <p className="text-gray-600 mb-4">
                  You are about to rerun {selectedTests.length} test{selectedTests.length !== 1 ? 's' : ''}.
                  This will create a new test run linked to the original.
                </p>

                {error && (
                  <div className="mb-4 p-3 bg-danger-50 border border-danger-200 rounded-lg flex items-start space-x-2">
                    <AlertCircle className="w-5 h-5 text-danger-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-danger-700">{error}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-700">
                    Selected Tests:
                  </h3>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-200 max-h-60 overflow-y-auto">
                    {selectedTests.map((test, idx) => (
                      <div
                        key={idx}
                        className="p-3 flex items-start space-x-3"
                      >
                        <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          test.success
                            ? 'bg-success-100 text-success-700'
                            : 'bg-danger-100 text-danger-700'
                        }`}>
                          {test.index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {test.goal}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {test.url}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-700">
                    <strong>Note:</strong> Tests will run on the dashboard server using the configured OpenAI API key.
                    Results will be available in real-time.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
            {success ? (
              <button
                onClick={handleClose}
                className="btn btn-primary"
              >
                View Test Run
              </button>
            ) : (
              <>
                <button
                  onClick={handleClose}
                  className="btn btn-secondary"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRerun}
                  className="btn btn-primary flex items-center space-x-2"
                  disabled={isSubmitting || selectedTests.length === 0}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>Rerun {selectedTests.length} Test{selectedTests.length !== 1 ? 's' : ''}</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
