export const getNextActiveNode = (currentNode, failedNodeIds, ringSize) => {
  for (let offset = 1; offset <= ringSize; offset += 1) {
    const candidateNode = (currentNode + offset) % ringSize;

    if (!failedNodeIds.includes(candidateNode)) {
      return candidateNode;
    }
  }

  return null;
};

export const getSkippedFailedNodes = (currentNode, nextNode, failedNodeIds, ringSize) => {
  const skippedNodes = [];
  let candidateNode = (currentNode + 1) % ringSize;

  while (candidateNode !== nextNode) {
    if (failedNodeIds.includes(candidateNode)) {
      skippedNodes.push(candidateNode);
    }

    candidateNode = (candidateNode + 1) % ringSize;
  }

  return skippedNodes;
};

export const enqueueRequest = (requestQueue, nodeId) => {
  return requestQueue.includes(nodeId) ? requestQueue : [...requestQueue, nodeId];
};

export const removeRequest = (requestQueue, nodeId) => {
  return requestQueue.filter((queuedNodeId) => queuedNodeId !== nodeId);
};

export const getTokenLossTimeout = (activeNodeCount, passInterval) => {
  const rotationDuration = Math.max(1, activeNodeCount) * passInterval;
  const bufferDuration = Math.max(500, Math.round(passInterval * 0.35));

  return rotationDuration + bufferDuration;
};

export const selectHighestSequenceToken = (tokens) => {
  return tokens.reduce((highestToken, token) => {
    return token.id > highestToken.id ? token : highestToken;
  });
};

export const calculateAverage = (total, count) => {
  return count === 0 ? 0 : total / count;
};
