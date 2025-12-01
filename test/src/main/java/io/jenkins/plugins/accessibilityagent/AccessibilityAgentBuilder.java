package io.jenkins.plugins.accessibilityagent;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import hudson.EnvVars;
import hudson.Extension;
import hudson.FilePath;
import hudson.Launcher;
import hudson.model.AbstractProject;
import hudson.model.Result;
import hudson.model.Run;
import hudson.model.TaskListener;
import hudson.tasks.BuildStepDescriptor;
import hudson.tasks.Builder;
import hudson.util.FormValidation;
import jenkins.tasks.SimpleBuildStep;
import org.jenkinsci.Symbol;
import org.kohsuke.stapler.DataBoundConstructor;
import org.kohsuke.stapler.DataBoundSetter;
import org.kohsuke.stapler.QueryParameter;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Serializable;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Jenkins build step that runs accessibility tests using the AI-powered agent.
 */
public class AccessibilityAgentBuilder extends Builder implements SimpleBuildStep, Serializable {
    private static final long serialVersionUID = 1L;

    private final String testConfigFile;
    private boolean continueOnFailure = true;
    private boolean failBuildOnTestFailure = true;

    @DataBoundConstructor
    public AccessibilityAgentBuilder(String testConfigFile) {
        this.testConfigFile = testConfigFile;
    }

    public String getTestConfigFile() {
        return testConfigFile;
    }

    public boolean isContinueOnFailure() {
        return continueOnFailure;
    }

    @DataBoundSetter
    public void setContinueOnFailure(boolean continueOnFailure) {
        this.continueOnFailure = continueOnFailure;
    }

    public boolean isFailBuildOnTestFailure() {
        return failBuildOnTestFailure;
    }

    @DataBoundSetter
    public void setFailBuildOnTestFailure(boolean failBuildOnTestFailure) {
        this.failBuildOnTestFailure = failBuildOnTestFailure;
    }

    @Override
    public void perform(Run<?, ?> run, FilePath workspace, EnvVars env, Launcher launcher, TaskListener listener)
            throws InterruptedException, IOException {

        AccessibilityAgentGlobalConfiguration globalConfig = AccessibilityAgentGlobalConfiguration.get();

        // Validate global configuration
        if (globalConfig.getAgentPath() == null || globalConfig.getAgentPath().isEmpty()) {
            listener.error("Accessibility Agent path not configured. Please configure it in Jenkins global settings.");
            run.setResult(Result.FAILURE);
            return;
        }

        String apiKey = globalConfig.getApiKey();
        if (apiKey == null || apiKey.isEmpty()) {
            listener.error("API key not configured for provider: " + globalConfig.getLlmProvider());
            run.setResult(Result.FAILURE);
            return;
        }

        // Read and parse test configuration file
        FilePath configFile = workspace.child(testConfigFile);
        if (!configFile.exists()) {
            listener.error("Test configuration file not found: " + testConfigFile);
            run.setResult(Result.FAILURE);
            return;
        }

        List<TestConfig> testConfigs = parseTestConfig(configFile, listener);
        if (testConfigs.isEmpty()) {
            listener.error("No tests found in configuration file: " + testConfigFile);
            run.setResult(Result.FAILURE);
            return;
        }

        listener.getLogger().println("===========================================");
        listener.getLogger().println("  Accessibility Agent Test Runner");
        listener.getLogger().println("===========================================");
        listener.getLogger().println("Tests to run: " + testConfigs.size());
        listener.getLogger().println("LLM Provider: " + globalConfig.getLlmProvider());
        listener.getLogger().println("Headless: " + globalConfig.isHeadlessBrowser());
        listener.getLogger().println();

        List<AccessibilityTestResult> results = new ArrayList<>();
        long totalStartTime = System.currentTimeMillis();
        boolean hasFailure = false;

        for (int i = 0; i < testConfigs.size(); i++) {
            TestConfig config = testConfigs.get(i);
            listener.getLogger().println("-------------------------------------------");
            listener.getLogger().println("Test " + (i + 1) + "/" + testConfigs.size());
            listener.getLogger().println("URL: " + config.url);
            listener.getLogger().println("Goal: " + config.goal);
            listener.getLogger().println("-------------------------------------------");

            long testStartTime = System.currentTimeMillis();

            try {
                AccessibilityTestResult result = runSingleTest(
                        config, globalConfig, workspace, launcher, listener, env
                );
                long testDuration = System.currentTimeMillis() - testStartTime;

                // Create result with actual duration
                AccessibilityTestResult finalResult = new AccessibilityTestResult(
                        result.getUrl(),
                        result.getGoal(),
                        result.isSuccess(),
                        result.getReason(),
                        result.getError(),
                        result.getStepCount(),
                        result.getSteps(),
                        result.getViolations(),
                        testDuration
                );

                results.add(finalResult);

                if (!result.isSuccess()) {
                    hasFailure = true;
                    String failReason = result.getError() != null ? result.getError() :
                                       (result.getReason() != null ? result.getReason() : "Test did not pass");
                    listener.getLogger().println("FAILED: " + failReason);
                } else {
                    String passReason = result.getReason() != null ? result.getReason() : "Test completed successfully";
                    listener.getLogger().println("PASSED: " + passReason);
                }

            } catch (Exception e) {
                long testDuration = System.currentTimeMillis() - testStartTime;
                hasFailure = true;

                AccessibilityTestResult errorResult = new AccessibilityTestResult(
                        config.url,
                        config.goal,
                        false,
                        null,
                        e.getMessage(),
                        0,
                        new ArrayList<>(),
                        new ArrayList<>(),
                        testDuration
                );
                results.add(errorResult);

                listener.error("Test error: " + e.getMessage());

                if (!continueOnFailure) {
                    listener.error("Stopping due to test failure (continueOnFailure=false)");
                    break;
                }
            }

            listener.getLogger().println();
        }

        long totalDuration = System.currentTimeMillis() - totalStartTime;

        // Attach results to build
        AccessibilityAgentBuildAction action = new AccessibilityAgentBuildAction(results, totalDuration);
        run.addAction(action);

        // Print summary
        listener.getLogger().println("===========================================");
        listener.getLogger().println("  Test Summary");
        listener.getLogger().println("===========================================");
        listener.getLogger().println("Total: " + action.getTotalTests());
        listener.getLogger().println("Passed: " + action.getPassedTests());
        listener.getLogger().println("Failed: " + action.getFailedTests());
        listener.getLogger().println("Pass Rate: " + action.getFormattedPassRate());
        listener.getLogger().println("Duration: " + action.getFormattedTotalDuration());
        listener.getLogger().println("===========================================");

        // Send results to dashboard if configured
        sendResultsToDashboard(run, env, globalConfig, results, totalDuration, listener);

        // Set build result based on test outcomes
        if (hasFailure && failBuildOnTestFailure) {
            run.setResult(Result.FAILURE);
        }
    }

    /**
     * Sends test results to the external dashboard if configured.
     */
    private void sendResultsToDashboard(Run<?, ?> run, EnvVars env,
                                         AccessibilityAgentGlobalConfiguration globalConfig,
                                         List<AccessibilityTestResult> results,
                                         long totalDuration,
                                         TaskListener listener) {
        String dashboardUrl = globalConfig.getDashboardUrl();
        String dashboardApiKey = globalConfig.getDashboardApiKey();

        if (dashboardUrl == null || dashboardUrl.isEmpty()) {
            return; // Dashboard not configured, skip
        }

        if (dashboardApiKey == null || dashboardApiKey.isEmpty()) {
            listener.getLogger().println("Dashboard URL configured but API key is missing. Skipping dashboard reporting.");
            return;
        }

        try {
            listener.getLogger().println();
            listener.getLogger().println("Sending results to dashboard: " + dashboardUrl);

            // Build the JSON payload
            JsonObject payload = new JsonObject();
            payload.addProperty("platform", "jenkins");
            payload.addProperty("buildNumber", String.valueOf(run.getNumber()));
            payload.addProperty("buildUrl", run.getAbsoluteUrl());

            // Get branch and commit info from environment
            String branch = env.get("GIT_BRANCH", env.get("BRANCH_NAME", ""));
            String commit = env.get("GIT_COMMIT", "");
            if (!branch.isEmpty()) {
                payload.addProperty("branch", branch.replace("origin/", ""));
            }
            if (!commit.isEmpty()) {
                payload.addProperty("commit", commit);
            }

            payload.addProperty("totalDuration", totalDuration);

            // Add results array
            JsonArray resultsArray = new JsonArray();
            for (AccessibilityTestResult result : results) {
                JsonObject resultObj = new JsonObject();
                resultObj.addProperty("url", result.getUrl());
                resultObj.addProperty("goal", result.getGoal());
                resultObj.addProperty("success", result.isSuccess());
                if (result.getReason() != null) {
                    resultObj.addProperty("reason", result.getReason());
                }
                if (result.getError() != null) {
                    resultObj.addProperty("error", result.getError());
                }
                resultObj.addProperty("duration", result.getDurationMs());

                // Add steps
                JsonArray stepsArray = new JsonArray();
                for (AccessibilityTestResult.TestStep step : result.getSteps()) {
                    JsonObject stepObj = new JsonObject();
                    stepObj.addProperty("stepNumber", step.getStepNumber());
                    stepObj.addProperty("action", step.getAction());
                    stepObj.addProperty("observation", step.getObservation());
                    if (step.getThought() != null && !step.getThought().isEmpty()) {
                        stepObj.addProperty("thought", step.getThought());
                    }
                    stepsArray.add(stepObj);
                }
                resultObj.add("steps", stepsArray);

                // Add violations
                JsonArray violationsArray = new JsonArray();
                for (AccessibilityTestResult.Violation violation : result.getViolations()) {
                    JsonObject violObj = new JsonObject();
                    violObj.addProperty("type", violation.getType());
                    violObj.addProperty("message", violation.getMessage());
                    if (violation.getElement() != null && !violation.getElement().isEmpty()) {
                        violObj.addProperty("element", violation.getElement());
                    }
                    violObj.addProperty("severity", violation.getSeverity());
                    violationsArray.add(violObj);
                }
                resultObj.add("violations", violationsArray);

                resultsArray.add(resultObj);
            }
            payload.add("results", resultsArray);

            // Send HTTP POST request
            String apiEndpoint = dashboardUrl.endsWith("/") ? dashboardUrl + "api/results" : dashboardUrl + "/api/results";
            URL url = new URL(apiEndpoint);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("X-API-Key", dashboardApiKey);
            conn.setDoOutput(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(30000);

            String jsonPayload = new Gson().toJson(payload);

            try (OutputStream os = conn.getOutputStream()) {
                byte[] input = jsonPayload.getBytes(StandardCharsets.UTF_8);
                os.write(input, 0, input.length);
            }

            int responseCode = conn.getResponseCode();
            if (responseCode == 200 || responseCode == 201) {
                // Read response to get testRunId
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    StringBuilder response = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        response.append(line);
                    }
                    JsonObject responseJson = JsonParser.parseString(response.toString()).getAsJsonObject();
                    if (responseJson.has("testRunId")) {
                        String testRunId = responseJson.get("testRunId").getAsString();
                        listener.getLogger().println("Results sent successfully. View at: " + dashboardUrl + "/runs/" + testRunId);
                    } else {
                        listener.getLogger().println("Results sent to dashboard successfully.");
                    }
                }
            } else {
                listener.getLogger().println("Warning: Failed to send results to dashboard. HTTP " + responseCode);
                // Try to read error response
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                    StringBuilder response = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        response.append(line);
                    }
                    listener.getLogger().println("Dashboard error: " + response.toString());
                } catch (Exception ignored) {}
            }

            conn.disconnect();
        } catch (Exception e) {
            listener.getLogger().println("Warning: Could not send results to dashboard: " + e.getMessage());
        }
    }

    private AccessibilityTestResult runSingleTest(TestConfig config,
                                                   AccessibilityAgentGlobalConfiguration globalConfig,
                                                   FilePath workspace,
                                                   Launcher launcher,
                                                   TaskListener listener,
                                                   EnvVars env) throws IOException, InterruptedException {

        // Build the command to run the agent using npm script
        // Use the npm path from the environment's PATH (set by NodeJS tool)
        String npmCommand = "npm";
        String path = env.get("PATH", "");
        if (!path.isEmpty()) {
            // Search for npm in PATH directories
            for (String dir : path.split(":")) {
                FilePath npmPath = new FilePath(launcher.getChannel(), dir + "/npm");
                try {
                    if (npmPath.exists()) {
                        npmCommand = dir + "/npm";
                        break;
                    }
                } catch (Exception e) {
                    // Continue searching
                }
            }
        }

        List<String> command = new ArrayList<>();
        command.add(npmCommand);
        command.add("run");
        command.add("start:agent-cli");
        command.add("--");
        command.add(config.url);
        command.add(config.goal);
        command.add(globalConfig.getLlmProvider());
        command.add("--json"); // Request JSON output for parsing

        // Set up environment with API key - include full PATH from Jenkins
        EnvVars processEnv = new EnvVars(env);
        String apiKey = globalConfig.getApiKey();
        if ("openai".equals(globalConfig.getLlmProvider())) {
            processEnv.put("OPENAI_API_KEY", apiKey);
        } else {
            processEnv.put("GEMINI_API_KEY", apiKey);
        }

        if (globalConfig.isHeadlessBrowser()) {
            processEnv.put("HEADLESS", "true");
        }

        // Execute the agent from the agent installation directory
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();

        Launcher.ProcStarter procStarter = launcher.launch()
                .cmds(command)
                .envs(processEnv)
                .pwd(new FilePath(launcher.getChannel(), globalConfig.getAgentPath()))
                .stdout(stdout)
                .stderr(stderr);

        int exitCode = procStarter.join();

        String output = stdout.toString(StandardCharsets.UTF_8.name());
        String errorOutput = stderr.toString(StandardCharsets.UTF_8.name());

        // Log output to console
        if (!output.isEmpty()) {
            listener.getLogger().println(output);
        }
        if (!errorOutput.isEmpty()) {
            listener.getLogger().println("STDERR: " + errorOutput);
        }

        // Parse JSON result from output
        return parseAgentOutput(config.url, config.goal, output, errorOutput, exitCode);
    }

    private AccessibilityTestResult parseAgentOutput(String url, String goal, String output,
                                                      String errorOutput, int exitCode) {
        // Try to find JSON in the output
        try {
            // The agent outputs JSON starting with {"url"
            int jsonStart = output.indexOf("{\"url\"");
            if (jsonStart >= 0) {
                String jsonStr = output.substring(jsonStart);
                // Find matching closing brace
                int braceCount = 0;
                int jsonEnd = -1;
                for (int i = 0; i < jsonStr.length(); i++) {
                    char c = jsonStr.charAt(i);
                    if (c == '{') braceCount++;
                    else if (c == '}') {
                        braceCount--;
                        if (braceCount == 0) {
                            jsonEnd = i + 1;
                            break;
                        }
                    }
                }

                if (jsonEnd > 0) {
                    jsonStr = jsonStr.substring(0, jsonEnd);
                    JsonObject json = JsonParser.parseString(jsonStr).getAsJsonObject();

                    boolean success = json.has("success") && !json.get("success").isJsonNull() && json.get("success").getAsBoolean();
                    String reason = json.has("reason") && !json.get("reason").isJsonNull() ? json.get("reason").getAsString() : null;
                    String error = json.has("error") && !json.get("error").isJsonNull() ? json.get("error").getAsString() : null;

                    List<AccessibilityTestResult.TestStep> steps = new ArrayList<>();
                    if (json.has("steps") && json.get("steps").isJsonArray()) {
                        JsonArray stepsArray = json.getAsJsonArray("steps");
                        for (JsonElement stepEl : stepsArray) {
                            JsonObject stepObj = stepEl.getAsJsonObject();
                            steps.add(new AccessibilityTestResult.TestStep(
                                    stepObj.has("stepNumber") ? stepObj.get("stepNumber").getAsInt() : 0,
                                    stepObj.has("action") ? stepObj.get("action").toString() : "",
                                    stepObj.has("observation") ? stepObj.get("observation").getAsString() : "",
                                    stepObj.has("thought") ? stepObj.get("thought").getAsString() : ""
                            ));
                        }
                    }

                    List<AccessibilityTestResult.Violation> violations = new ArrayList<>();
                    if (json.has("violations") && json.get("violations").isJsonArray()) {
                        JsonArray violationsArray = json.getAsJsonArray("violations");
                        for (JsonElement violEl : violationsArray) {
                            JsonObject violObj = violEl.getAsJsonObject();
                            violations.add(new AccessibilityTestResult.Violation(
                                    violObj.has("type") ? violObj.get("type").getAsString() : "unknown",
                                    violObj.has("message") ? violObj.get("message").getAsString() : "",
                                    violObj.has("element") ? violObj.get("element").getAsString() : "",
                                    violObj.has("severity") ? violObj.get("severity").getAsString() : "minor"
                            ));
                        }
                    }

                    return new AccessibilityTestResult(
                            url, goal, success, reason, error,
                            steps.size(), steps, violations, 0
                    );
                }
            }
        } catch (Exception e) {
            // Fall through to error handling
        }

        // If we couldn't parse JSON, create an error result
        String error = exitCode != 0
                ? "Agent exited with code " + exitCode + ": " + errorOutput
                : "Could not parse agent output";

        return new AccessibilityTestResult(
                url, goal, false, null, error,
                0, new ArrayList<>(), new ArrayList<>(), 0
        );
    }

    private List<TestConfig> parseTestConfig(FilePath configFile, TaskListener listener) throws IOException, InterruptedException {
        List<TestConfig> configs = new ArrayList<>();

        String content = configFile.readToString();
        String fileName = configFile.getName().toLowerCase();

        try {
            if (fileName.endsWith(".json")) {
                // Parse JSON format
                JsonArray tests = JsonParser.parseString(content).getAsJsonArray();
                for (JsonElement el : tests) {
                    JsonObject testObj = el.getAsJsonObject();
                    String url = testObj.get("url").getAsString();
                    String goal = testObj.get("goal").getAsString();
                    configs.add(new TestConfig(url, goal));
                }
            } else {
                // Parse simple text format: url|goal per line
                String[] lines = content.split("\n");
                for (String line : lines) {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) {
                        continue;
                    }
                    String[] parts = line.split("\\|", 2);
                    if (parts.length == 2) {
                        configs.add(new TestConfig(parts[0].trim(), parts[1].trim()));
                    }
                }
            }
        } catch (Exception e) {
            listener.error("Error parsing test config file: " + e.getMessage());
        }

        return configs;
    }

    private static class TestConfig {
        final String url;
        final String goal;

        TestConfig(String url, String goal) {
            this.url = url;
            this.goal = goal;
        }
    }

    @Symbol("accessibilityAgent")
    @Extension
    public static final class DescriptorImpl extends BuildStepDescriptor<Builder> {

        public FormValidation doCheckTestConfigFile(@QueryParameter String value) {
            if (value == null || value.isEmpty()) {
                return FormValidation.error(Messages.AccessibilityAgentBuilder_errors_missingConfigFile());
            }
            return FormValidation.ok();
        }

        @Override
        public boolean isApplicable(Class<? extends AbstractProject> aClass) {
            return true;
        }

        @Override
        public String getDisplayName() {
            return Messages.AccessibilityAgentBuilder_DisplayName();
        }
    }
}
