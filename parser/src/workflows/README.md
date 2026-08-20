# Workflows

This folder contains high-level workflow orchestrators that coordinate the analysis process.

## Files

- **java-project-analyzer.ts** - Main workflow for analyzing Java projects:
  - Orchestrates the complete analysis pipeline
  - Processes multiple Java projects in parallel
  - Extracts types, type parameters, type references, and annotations
  - Aggregates results from all projects
  - Exports data to CSV files
  - Provides progress reporting and statistics

- **index.ts** - Barrel export file

## Purpose

Workflows represent the top-level business logic that:
- Coordinates multiple components (detectors, parsers, extractors)
- Manages the end-to-end analysis process
- Handles data aggregation and export
- Provides the main entry point for analysis operations

Each workflow encapsulates a complete analysis pipeline for a specific language or analysis type.
