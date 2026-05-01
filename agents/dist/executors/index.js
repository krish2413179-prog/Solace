import { callOGCompute } from "../og/compute.js";
import { getLogger } from "../utils/logger.js";
const logger = getLogger("executors");
const REGISTRY = new Map();
function register(jobType, fn) {
    REGISTRY.set(jobType, fn);
    logger.debug(`Registered executor: ${jobType}`);
}
export function getAvailableJobs() {
    return Array.from(REGISTRY.keys());
}
export async function execute(wallet, jobType, input, params = {}) {
    const fn = REGISTRY.get(jobType);
    if (!fn)
        throw new Error(`No executor for '${jobType}'. Available: ${getAvailableJobs().join(", ")}`);
    logger.info(`Executing job via 0G Compute: ${jobType}`);
    const result = await fn(wallet, input, params);
    logger.info(`Job complete: ${jobType} | ${result.length} chars`);
    return result;
}
register("static_analysis", async (_w, input) => (await callOGCompute("You are a Solidity security auditor. Analyze for reentrancy, integer overflow, access control issues, front-running, and other vulnerabilities. Return a structured JSON report with severity levels (Critical/High/Medium/Low) and remediation steps.", `Audit this Solidity contract:\n\n${input}`)).output);
register("business_logic_audit", async (_w, input) => (await callOGCompute("You are a smart contract business logic auditor. Identify economic attack vectors, logic flaws, sandwich attack possibilities, and mismatches between stated intent and implementation. Be precise and actionable.", `Analyze this contract for business logic flaws:\n\n${input}`)).output);
register("gas_optimization", async (_w, input) => (await callOGCompute("You are a Solidity gas optimization expert. Find storage packing opportunities, unnecessary SLOADs, loop inefficiencies, and calldata vs memory optimizations. Estimate gas savings per function.", `Optimize gas usage in:\n\n${input}`)).output);
register("test_coverage_analysis", async (_w, input) => (await callOGCompute("You are a smart contract testing expert. Identify untested code paths, missing edge cases, and generate missing test cases in Foundry format. Include fuzz tests where appropriate.", `Generate missing tests for:\n\n${input}`)).output);
register("tokenomics_analysis", async (_w, input) => (await callOGCompute("You are a tokenomics analyst. Model emission schedules, vesting cliff pressure on price, unlock event impact, inflation rate, and identify rug pull risk vectors with probability estimates.", `Analyze tokenomics for:\n\n${input}`)).output);
register("defi_risk_analysis", async (_w, input) => (await callOGCompute("You are a DeFi risk analyst. Assess liquidity risk, oracle manipulation vectors, liquidation cascade scenarios, flash loan attack surfaces, and protocol dependency risks. Output risk scores per category.", `Assess DeFi risk for:\n\n${input}`)).output);
register("code_review", async (_w, input) => (await callOGCompute("You are a senior software engineer. Review code for security vulnerabilities, architectural issues, performance bottlenecks, missing tests, and documentation gaps. Be specific and prioritized.", `Review this code:\n\n${input}`)).output);
register("liquidity_analysis", async (_w, input) => (await callOGCompute("You are a DeFi liquidity analyst. Analyze LP lock duration and size, model minimum safe exit liquidity, rug pull scenario probabilities, and slippage impact at various exit sizes.", `Analyze liquidity for:\n\n${input}`)).output);
// ============================================================================
// AI/ML EXECUTORS
// ============================================================================
// Data Collection & Processing
register("data_collection", async (_w, input, params) => (await callOGCompute("You are a data collection specialist. Extract, scrape, and gather data from the provided sources. Return structured JSON data with proper formatting and validation.", `Collect data from: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("data_scraping", async (_w, input, params) => (await callOGCompute("You are a web scraping expert. Extract data from web sources, handle pagination, parse HTML/JSON, and return clean structured data.", `Scrape data from: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("data_processing", async (_w, input, params) => (await callOGCompute("You are a data processing expert. Clean, normalize, transform, and prepare data for analysis or ML training. Handle missing values, outliers, and format conversions.", `Process this data: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("data_aggregation", async (_w, input, params) => (await callOGCompute("You are a data aggregation specialist. Combine multiple data sources, resolve conflicts, compute statistics, and produce unified datasets.", `Aggregate data: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("dataset_compilation", async (_w, input, params) => (await callOGCompute("You are a dataset compiler. Merge, validate, and structure datasets for ML training. Ensure consistency, completeness, and proper formatting.", `Compile dataset from: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("dataset_distribution", async (_w, input, params) => (await callOGCompute("You are a dataset distribution specialist. Split datasets into train/validation/test sets, ensure balanced distributions, and handle stratification.", `Distribute dataset: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// NLP & Text Processing
register("text_preprocessing", async (_w, input, params) => (await callOGCompute("You are an NLP preprocessing expert. Tokenize, normalize, remove stopwords, handle stemming/lemmatization, and prepare text for analysis.", `Preprocess text: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("nlp_preprocessing", async (_w, input, params) => (await callOGCompute("You are an NLP preprocessing expert. Tokenize, normalize, remove stopwords, handle stemming/lemmatization, and prepare text for analysis.", `Preprocess text: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("sentiment_analysis", async (_w, input, params) => (await callOGCompute("You are a sentiment analysis expert. Analyze text sentiment (positive/negative/neutral), provide confidence scores, and identify emotional tone. Return structured JSON with sentiment labels and scores.", `Analyze sentiment of: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("sentiment_classification", async (_w, input, params) => (await callOGCompute("You are a sentiment classifier. Classify text into sentiment categories with confidence scores. Handle nuanced emotions and context.", `Classify sentiment: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("entity_extraction", async (_w, input, params) => (await callOGCompute("You are a named entity recognition (NER) expert. Extract entities like persons, organizations, locations, dates, and custom entities from text. Return structured JSON.", `Extract entities from: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("ner", async (_w, input, params) => (await callOGCompute("You are a named entity recognition (NER) expert. Extract entities like persons, organizations, locations, dates, and custom entities from text. Return structured JSON.", `Extract entities from: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// Machine Learning
register("ml_training", async (_w, input, params) => (await callOGCompute("You are an ML training specialist. Train models on provided data, tune hyperparameters, validate performance, and return model metrics and weights.", `Train ML model on: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("ml_inference", async (_w, input, params) => (await callOGCompute("You are an ML inference specialist. Run predictions using trained models, handle batch inference, and return predictions with confidence scores.", `Run inference on: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("ml_validation", async (_w, input, params) => (await callOGCompute("You are an ML validation expert. Validate model performance, compute metrics (accuracy, precision, recall, F1), detect overfitting, and provide improvement recommendations.", `Validate ML model: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("ml_aggregation", async (_w, input, params) => (await callOGCompute("You are an ML aggregation specialist. Combine predictions from multiple models, perform ensemble learning, and produce consensus predictions.", `Aggregate ML results: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("model_deployment", async (_w, input, params) => (await callOGCompute("You are an ML deployment specialist. Package models for production, optimize for inference, and provide deployment configurations.", `Deploy model: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// Image & Annotation
register("image_annotation", async (_w, input, params) => (await callOGCompute("You are an image annotation expert. Label images with bounding boxes, segmentation masks, or classification labels. Return structured annotation data.", `Annotate images: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("image_labeling", async (_w, input, params) => (await callOGCompute("You are an image labeling specialist. Classify and tag images with appropriate labels, handle multi-label scenarios, and ensure consistency.", `Label images: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// Quality Control & Validation
register("quality_control", async (_w, input, params) => (await callOGCompute("You are a quality control specialist. Validate data quality, detect anomalies, check consistency, and flag issues. Return quality metrics and recommendations.", `Quality check: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("quality_validation", async (_w, input, params) => (await callOGCompute("You are a quality validation expert. Verify data meets quality standards, validate annotations, and ensure accuracy. Return validation results.", `Validate quality: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("anomaly_detection", async (_w, input, params) => (await callOGCompute("You are an anomaly detection specialist. Identify outliers, unusual patterns, and data quality issues. Return anomaly scores and explanations.", `Detect anomalies in: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// Analysis & Reporting
register("data_analysis", async (_w, input, params) => (await callOGCompute("You are a data analyst. Perform statistical analysis, identify trends, compute correlations, and generate insights from data.", `Analyze data: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("trend_analysis", async (_w, input, params) => (await callOGCompute("You are a trend analysis expert. Identify patterns, forecast trends, detect seasonality, and provide predictive insights.", `Analyze trends in: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("report_generation", async (_w, input, params) => (await callOGCompute("You are a report generation specialist. Create comprehensive reports with visualizations, summaries, and actionable insights.", `Generate report for: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("reporting", async (_w, input, params) => (await callOGCompute("You are a reporting specialist. Create comprehensive reports with visualizations, summaries, and actionable insights.", `Generate report for: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// Consensus & Coordination
register("consensus", async (_w, input, params) => (await callOGCompute("You are a consensus algorithm specialist. Aggregate multiple agent outputs, resolve conflicts, and produce consensus results with confidence scores.", `Build consensus from: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("consensus_resolution", async (_w, input, params) => (await callOGCompute("You are a consensus resolution expert. Resolve disagreements between agents, weight contributions, and produce final consensus.", `Resolve consensus for: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("consensus_algorithm", async (_w, input, params) => (await callOGCompute("You are a consensus algorithm specialist. Implement voting, weighted averaging, or Byzantine fault-tolerant consensus mechanisms.", `Apply consensus algorithm to: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// Metadata & Documentation
register("metadata", async (_w, input, params) => (await callOGCompute("You are a metadata specialist. Generate comprehensive metadata for datasets, models, and results. Include provenance, statistics, and quality metrics.", `Generate metadata for: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("metadata_generation", async (_w, input, params) => (await callOGCompute("You are a metadata generation expert. Create detailed metadata including schema, statistics, lineage, and quality indicators.", `Generate metadata for: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// Oracle & Blockchain Integration
register("oracle_integration", async (_w, input, params) => (await callOGCompute("You are an oracle integration specialist. Fetch external data, validate sources, and format for blockchain consumption.", `Integrate oracle data: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("chainlink_oracle", async (_w, input, params) => (await callOGCompute("You are a Chainlink oracle specialist. Fetch and validate data from Chainlink feeds, handle aggregation, and ensure data integrity.", `Process Chainlink data: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("logic_evaluation", async (_w, input, params) => (await callOGCompute("You are a logic evaluation specialist. Evaluate complex logical conditions, validate rules, and return boolean results with explanations.", `Evaluate logic: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
// General Purpose
register("computation", async (_w, input, params) => (await callOGCompute("You are a general computation specialist. Perform calculations, transformations, and data operations as specified.", `Compute: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("verification", async (_w, input, params) => (await callOGCompute("You are a verification specialist. Verify data integrity, validate results, and ensure correctness of computations.", `Verify: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("validation", async (_w, input, params) => (await callOGCompute("You are a validation specialist. Validate inputs, check constraints, and ensure data meets requirements.", `Validate: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("aggregation", async (_w, input, params) => (await callOGCompute("You are an aggregation specialist. Combine multiple inputs, compute statistics, and produce unified results.", `Aggregate: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
register("coordination", async (_w, input, params) => (await callOGCompute("You are a coordination specialist. Orchestrate multi-agent workflows, manage dependencies, and ensure proper execution order.", `Coordinate: ${input}\nParameters: ${JSON.stringify(params)}`)).output);
//# sourceMappingURL=index.js.map