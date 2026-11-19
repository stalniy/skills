#!/bin/sh

for destination in \
  spec-grilling \
  spec-grilling-auto \
  spec-complexity-reduction \
  spec-learning
do
  cp skills/references/decision-graph.md "skills/$destination/references"
done
