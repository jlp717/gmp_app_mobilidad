/**
 * GMP App - Pattern Learning Service
 * ================================
 * Learns from user behavior and improves recommendations over time
 * Uses in-memory pattern matching for fast responses
 */

const logger = require('../middleware/logger');

// Pattern storage (in production this would use AgentDB)
const patternStore = new Map();

// User behavior patterns
const userPatterns = {
    purchaseHistory: new Map(),      // User -> [product codes]
    searchHistory: new Map(),        // User -> [search terms]
    timePreferences: new Map()      // User -> { morning, afternoon, evening }
};

// Popular products by time of day
const popularByTime = {
    morning: new Set(),
    afternoon: new Set(),
    evening: new Set()
};

class PatternLearner {
    
    /**
     * Record a product view
     */
    static recordView(userCode, productCode) {
        if (!userCode || !productCode) return;
        
        const history = userPatterns.purchaseHistory.get(userCode) || [];
        history.push({ productCode, timestamp: Date.now() });
        
        // Keep last 50 products
        if (history.length > 50) {
            history.shift();
        }
        
        userPatterns.purchaseHistory.set(userCode, history);
        
        // Update popular by time of day
        const hour = new Date().getHours();
        let timeKey = 'evening';
        if (hour >= 6 && hour < 12) timeKey = 'morning';
        else if (hour >= 12 && hour < 18) timeKey = 'afternoon';
        
        popularByTime[timeKey].add(productCode);
    }
    
    /**
     * Record a search
     */
    static recordSearch(userCode, searchTerm) {
        if (!userCode || !searchTerm) return;
        
        const history = userPatterns.searchHistory.get(userCode) || [];
        history.push({ term: searchTerm.toLowerCase(), timestamp: Date.now() });
        
        if (history.length > 20) history.shift();
        
        userPatterns.searchHistory.set(userCode, history);
    }
    
    /**
     * Get recommendations for a user
     */
    static getRecommendations(userCode, limit = 5) {
        const recommendations = [];
        
        // Get user's purchase history
        const history = userPatterns.purchaseHistory.get(userCode) || [];
        const purchased = new Set(history.map(h => h.productCode));
        
        // Get similar users who bought similar products
        const similarUsers = this.findSimilarUsers(userCode);
        
        for (const similarUser of similarUsers) {
            const theirHistory = userPatterns.purchaseHistory.get(similarUser) || [];
            for (const item of theirHistory) {
                if (!purchased.has(item.productCode)) {
                    recommendations.push({
                        productCode: item.productCode,
                        score: (recommendations.length + 1),
                        source: 'similar_user'
                    });
                }
            }
        }
        
        // Add popular items by time of day
        const hour = new Date().getHours();
        let timeKey = 'evening';
        if (hour >= 6 && hour < 12) timeKey = 'morning';
        else if (hour >= 12 && hour < 18) timeKey = 'afternoon';
        
        for (const code of popularByTime[timeKey]) {
            if (!purchased.has(code) && recommendations.length < limit * 2) {
                recommendations.push({
                    productCode: code,
                    score: recommendations.length + 1,
                    source: 'popular'
                });
            }
        }
        
        return recommendations.slice(0, limit);
    }
    
    /**
     * Find users with similar purchase patterns
     */
    static findSimilarUsers(userCode, limit = 3) {
        const userHistory = userPatterns.purchaseHistory.get(userCode) || [];
        const userProducts = new Set(userHistory.map(h => h.productCode));
        
        const similarities = [];
        
        for (const [otherUser, theirHistory] of userPatterns.purchaseHistory.entries()) {
            if (otherUser === userCode) continue;
            
            const otherProducts = new Set(theirHistory.map(h => h.productCode));
            
            // Calculate Jaccard similarity
            let intersection = 0;
            for (const p of userProducts) {
                if (otherProducts.has(p)) intersection++;
            }
            
            const union = new Set([...userProducts, ...otherProducts]).size;
            const similarity = union > 0 ? intersection / union : 0;
            
            if (similarity > 0.1) {
                similarities.push({ user: otherUser, similarity });
            }
        }
        
        similarities.sort((a, b) => b.similarity - a.similarity);
        
        return similarities.slice(0, limit).map(s => s.user);
    }
    
    /**
     * Get search suggestions based on history
     */
    static getSearchSuggestions(userCode, partial, limit = 3) {
        const history = userPatterns.searchHistory.get(userCode) || [];
        const suggestions = new Set();
        
        for (const item of history) {
            if (item.term.includes(partial.toLowerCase())) {
                suggestions.add(item.term);
            }
        }
        
        // Add popular searches from all users
        for (const [user, searchHistory] of userPatterns.searchHistory.entries()) {
            if (user === userCode) continue;
            for (const item of searchHistory) {
                if (item.term.includes(partial.toLowerCase())) {
                    suggestions.add(item.term);
                }
            }
        }
        
        return Array.from(suggestions).slice(0, limit);
    }
    
    /**
     * Get pattern statistics
     */
    static getStats() {
        return {
            totalUsers: userPatterns.purchaseHistory.size,
            totalSearches: userPatterns.searchHistory.size,
            popularProducts: {
                morning: popularByTime.morning.size,
                afternoon: popularByTime.afternoon.size,
                evening: popularByTime.evening.size
            }
        };
    }
}

module.exports = PatternLearner;