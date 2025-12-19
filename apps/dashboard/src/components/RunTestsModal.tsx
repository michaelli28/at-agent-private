'use client';

import { useState, useRef, ChangeEvent } from 'react';
import { X, Play, Loader2, AlertCircle, CheckCircle, Upload, FileJson } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ManualTest } from '@/types';

interface RunTestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onRunStarted: (testRunId: string) => void;
}

const EXAMPLE_JSON = `[
  {
    "url": "https://example.com",
    "goal": "Navigate to the main content and verify headings are accessible"
  },
  {
    "url": "https://example.com/login",
    "goal": "Complete the login form using only keyboard navigation"
  }
]`;

export default function RunTestsModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  onRunStarted,
}: RunTestsModalProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonInput, setJsonInput] = useState('');
  const [parsedTests, setParsedTests] = useState<ManualTest[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ testRunId: string } | null>(null);

  if (!isOpen) return null;

  const handleJsonChange = (value: string) => {
    setJsonInput(value);
    setParseError(null);
    setParsedTests(null);

    if (!value.trim()) {
      return;
    }

    try {
      const parsed = JSON.parse(value);

      if (!Array.isArray(parsed)) {
        setParseError('JSON must be an array of test objects');
        return;
      }

      if (parsed.length === 0) {
        setParseError('At least one test is required');
        return;
      }

      // Validate each test
      const tests: ManualTest[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const test = parsed[i];
        if (!test.url || typeof test.url !== 'string') {
          setParseError(`Test at index ${i} is missing a valid 'url' field`);
          return;
        }
        if (!test.goal || typeof test.goal !== 'string') {
          setParseError(`Test at index ${i} is missing a valid 'goal' field`);
          return;
        }

        // Validate URL
        try {
          new URL(test.url);
        } catch {
          setParseError(`Test at index ${i} has an invalid URL: '${test.url}'`);
          return;
        }

        tests.push({ url: test.url.trim(), goal: test.goal.trim() });
      }

      setParsedTests(tests);
    } catch (e) {
      setParseError('Invalid JSON format');
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setParseError('Please upload a JSON file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setJsonInput(content);
      handleJsonChange(content);
    };
    reader.onerror = () => {
      setParseError('Failed to read file');
    };
    reader.readAsText(file);

    // Reset the input so the same file can be selected again
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (!parsedTests || parsedTests.length === 0) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (!user) {
        throw new Error('User not logged in');
      }

      const idToken = await user.getIdToken();

      if (!idToken) {
        throw new Error('Failed to get authentication token');
      }

      const response = await fetch('/api/run-tests/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          projectId,
          tests: parsedTests,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start test run');
      }

      setSuccess({ testRunId: data.testRunId });
      onRunStarted(data.testRunId);
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setJsonInput('');
    setParsedTests(null);
    setParseError(null);
    setSubmitError(null);
    setSuccess(null);
    onClose();
  };

  const loadExample = () => {
    setJsonInput(EXAMPLE_JSON);
    handleJsonChange(EXAMPLE_JSON);
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
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <Play className="w-5 h-5 text-primary-600" />
              <h2 className="text-lg font-semibold text-gray-900">Run Tests</h2>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
            {success ? (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-success-500 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Tests Started!
                </h3>
                <p className="text-gray-600 mb-4">
                  Your {parsedTests?.length} test{parsedTests?.length !== 1 ? 's are' : ' is'} now running.
                  You'll be redirected to view the results.
                </p>
              </div>
            ) : (
              <>
                <p className="text-gray-600 mb-4">
                  Run accessibility tests for <strong>{projectName}</strong>.
                  Enter your test configuration as JSON or upload a JSON file.
                </p>

                {/* File Upload */}
                <div className="mb-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-secondary flex items-center space-x-2"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Upload JSON File</span>
                    </button>
                    <button
                      onClick={loadExample}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      Load example
                    </button>
                  </div>
                </div>

                {/* JSON Input */}
                <div className="mb-4">
                  <label className="label flex items-center space-x-1">
                    <FileJson className="w-4 h-4" />
                    <span>Test Configuration (JSON)</span>
                  </label>
                  <textarea
                    className={`input font-mono text-sm ${parseError ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500' : ''}`}
                    rows={12}
                    value={jsonInput}
                    onChange={(e) => handleJsonChange(e.target.value)}
                    placeholder={`Paste your test JSON here, e.g.:\n${EXAMPLE_JSON}`}
                  />
                </div>

                {/* Parse Error */}
                {parseError && (
                  <div className="mb-4 p-3 bg-danger-50 border border-danger-200 rounded-lg flex items-start space-x-2">
                    <AlertCircle className="w-5 h-5 text-danger-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-danger-700">{parseError}</p>
                  </div>
                )}

                {/* Submit Error */}
                {submitError && (
                  <div className="mb-4 p-3 bg-danger-50 border border-danger-200 rounded-lg flex items-start space-x-2">
                    <AlertCircle className="w-5 h-5 text-danger-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-danger-700">{submitError}</p>
                  </div>
                )}

                {/* Parsed Tests Preview */}
                {parsedTests && parsedTests.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-2">
                      {parsedTests.length} Test{parsedTests.length !== 1 ? 's' : ''} Ready to Run:
                    </h3>
                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-200 max-h-48 overflow-y-auto">
                      {parsedTests.map((test, idx) => (
                        <div key={idx} className="p-3 flex items-start space-x-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-medium">
                            {idx + 1}
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
                )}

                {/* Info Note */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-700">
                    <strong>Note:</strong> Tests will run on the server using the configured OpenAI API key.
                    Results will be available in real-time and stored with this project.
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
                  onClick={handleSubmit}
                  className="btn btn-primary flex items-center space-x-2"
                  disabled={isSubmitting || !parsedTests || parsedTests.length === 0}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Run {parsedTests?.length || 0} Test{parsedTests?.length !== 1 ? 's' : ''}</span>
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
