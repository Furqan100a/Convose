import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Keyboard,
  ScrollView,
  Alert,
} from 'react-native';
import React, {useState, useEffect, useCallback, useRef} from 'react';

// Utility function to format interest names by removing square brackets
const formatInterestName = (text: string): string => {
  return text.replace(/\[(.*?)\]/g, ' $1').trim();
};

// Function to split an interest name into main part and location part (if any)
const splitInterestNameAndLocation = (
  text: string,
): {main: string; location?: string} => {
  const match = text.match(/(.*?)\s*\[(.*?)\]/);
  if (match) {
    return {
      main: match[1].trim(),
      location: match[2].trim(),
    };
  }
  return {main: text.trim()};
};

// Updated Interface to match the actual API response structure
interface Interest {
  id?: string;
  name: string; // Primary search term
  emoji?: string;
  secondary_term?: string; // Changed from secondaryName to match API response
  popularity?: number;
}

const App = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Interest[]>([]);
  const [allFetchedSuggestions, setAllFetchedSuggestions] = useState<
    Interest[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<Interest[]>([]);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  // Store the entire fetched results cache by query
  const [suggestionsCache, setSuggestionsCache] = useState<{
    [query: string]: Interest[];
  }>({});
  // Store the last valid search results to show when input is empty
  const [lastSearchResults, setLastSearchResults] = useState<Interest[]>([]);
  // Store the last non-empty search query
  const [lastValidQuery, setLastValidQuery] = useState<string>('');

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialFetchDoneRef = useRef<boolean>(false);

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      () => {
        setKeyboardVisible(true);
      },
    );
    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => {
        setKeyboardVisible(false);
      },
    );

    return () => {
      keyboardDidHideListener.remove();
      keyboardDidShowListener.remove();
    };
  }, []);

  // Improved filtering function for YouTube-like behavior
  const filterSuggestionsLocally = useCallback(
    (query: string) => {
      if (query.trim() === '') {
        // When input is empty, show last search results instead of clearing
        setSuggestions(lastSearchResults);
        return true;
      }

      const normalizedQuery = query.toLowerCase().trim();

      // First check if we have an exact cache match
      if (suggestionsCache[normalizedQuery]) {
        const results = suggestionsCache[normalizedQuery];
        setSuggestions(results);

        // Save these as the last search results when they're valid
        if (results.length > 0) {
          setLastSearchResults(results);
          setLastValidQuery(normalizedQuery);
        }

        return true;
      }

      // Try to filter from existing results for any parent query
      // This is the key to YouTube-like behavior - we check ALL previous queries
      // to see if any can be filtered to match the current query
      for (const cachedQuery of Object.keys(suggestionsCache).sort(
        (a, b) => b.length - a.length,
      )) {
        // Only consider parent queries (ones that this query starts with)
        if (normalizedQuery.startsWith(cachedQuery)) {
          const cachedResults = suggestionsCache[cachedQuery];
          const filteredResults = cachedResults.filter(suggestion => {
            const primaryStartsWithMatch = suggestion.name
              .toLowerCase()
              .startsWith(normalizedQuery);
            const primaryIncludesMatch = suggestion.name
              .toLowerCase()
              .includes(normalizedQuery);

            const secondaryStartsWithMatch =
              suggestion.secondary_term &&
              suggestion.secondary_term
                .toLowerCase()
                .startsWith(normalizedQuery);

            const secondaryIncludesMatch =
              suggestion.secondary_term &&
              suggestion.secondary_term.toLowerCase().includes(normalizedQuery);

            // Prioritize exact matches and startsWith matches, but also include general substring matches
            return (
              primaryStartsWithMatch ||
              secondaryStartsWithMatch ||
              primaryIncludesMatch ||
              secondaryIncludesMatch
            );
          });

          // If we have results after filtering, use them
          if (filteredResults.length > 0) {
            setSuggestions(filteredResults);

            // Save these as the last search results
            setLastSearchResults(filteredResults);
            setLastValidQuery(normalizedQuery);

            // Cache these results too for faster retrieval next time
            setSuggestionsCache(prev => ({
              ...prev,
              [normalizedQuery]: filteredResults,
            }));
            return true;
          }
        }
      }

      // No cache hit and couldn't filter from existing results
      return false;
    },
    [suggestionsCache, lastSearchResults, lastValidQuery],
  );

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (query.trim() === '') {
        // When input is empty, show last search results instead of clearing
        setSuggestions(lastSearchResults);
        return;
      }

      // Try filtering locally first (YouTube-like behavior)
      if (filterSuggestionsLocally(query)) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `https://be-v2.convose.com/autocomplete/interests?q=${encodeURIComponent(
            query,
          )}&limit=20&from=0`, // Increased limit for better caching
          {
            method: 'GET',
            headers: {
              Authorization: 'Jy8RZCXvvc6pZQUu2QZ2',
              Accept: 'application/json',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Accept-Language':
                'en-GB,en;q=0.9,en-US;q=0.8,de-DE;q=0.7,de;q=0.6',
              Connection: 'keep-alive',
              Host: 'be-v2.convose.com',
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.status}`);
        }

        const data = await response.json();

        // Log the response to debug
        console.log('API Response:', JSON.stringify(data, null, 2));

        // Ensure we're handling the response correctly
        if (!data.autocomplete || !Array.isArray(data.autocomplete)) {
          console.error('Unexpected API response format:', data);
          setError('Invalid response format from server');
          setSuggestions([]);
          setLoading(false);
          return;
        }

        // Format all suggestion names and filter out already selected interests
        const formattedSuggestions = data.autocomplete.map(
          (suggestion: Interest) => ({
            ...suggestion,
            // We keep the original format with brackets for styling purposes
            name: suggestion.name || 'Unnamed Interest',
            secondary_term: suggestion.secondary_term,
          }),
        );

        const filteredSuggestions = formattedSuggestions.filter(
          (suggestion: Interest) =>
            !selectedInterests.some(
              item =>
                (item.id && suggestion.id && item.id === suggestion.id) ||
                item.name === suggestion.name,
            ),
        );

        // Cache results with the normalized query
        const normalizedQuery = query.toLowerCase().trim();
        setSuggestionsCache(prev => ({
          ...prev,
          [normalizedQuery]: filteredSuggestions || [],
        }));

        setSuggestions(filteredSuggestions || []);
        setAllFetchedSuggestions(prev => [...prev, ...filteredSuggestions]);

        // Save these as the last search results if we have results
        if (filteredSuggestions.length > 0) {
          setLastSearchResults(filteredSuggestions);
          setLastValidQuery(normalizedQuery);
        }

        initialFetchDoneRef.current = true;
      } catch (err) {
        console.error('Error fetching suggestions:', err);
        setError('Failed to fetch suggestions. Please try again.');
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedInterests, filterSuggestionsLocally, lastSearchResults],
  );

  // Preload common single letters for instant results
  useEffect(() => {
    if (!initialFetchDoneRef.current) {
      // Common first letters to preload
      const commonFirstLetters = ['a', 'b', 'c', 'd', 'e', 'g', 'm', 's', 't'];

      const preloadData = async () => {
        for (const letter of commonFirstLetters) {
          if (!suggestionsCache[letter]) {
            try {
              const response = await fetch(
                `https://be-v2.convose.com/autocomplete/interests?q=${letter}&limit=20&from=0`,
                {
                  method: 'GET',
                  headers: {
                    Authorization: 'Jy8RZCXvvc6pZQUu2QZ2',
                    Accept: 'application/json',
                  },
                },
              );
              if (response.ok) {
                const data = await response.json();
                if (data.autocomplete && Array.isArray(data.autocomplete)) {
                  // Format all suggestion names
                  const formattedSuggestions = data.autocomplete.map(
                    (suggestion: Interest) => ({
                      ...suggestion,
                      // Keep original name format with brackets
                      name: suggestion.name || 'Unnamed Interest',
                      secondary_term: suggestion.secondary_term,
                    }),
                  );

                  // Filter out already selected interests
                  const filteredSuggestions = formattedSuggestions.filter(
                    (suggestion: Interest) =>
                      !selectedInterests.some(
                        item =>
                          (item.id &&
                            suggestion.id &&
                            item.id === suggestion.id) ||
                          item.name === suggestion.name,
                      ),
                  );

                  setSuggestionsCache(prev => ({
                    ...prev,
                    [letter]: filteredSuggestions || [],
                  }));

                  // Initialize last search results with first preloaded letter's results
                  if (
                    letter === commonFirstLetters[0] &&
                    filteredSuggestions.length > 0 &&
                    lastSearchResults.length === 0
                  ) {
                    setLastSearchResults(filteredSuggestions);
                    setLastValidQuery(letter);
                  }
                }
              }
            } catch (error) {
              console.log(`Failed to preload data for letter ${letter}`);
            }
          }
        }
      };

      // Run preloading in background
      preloadData();
    }
  }, [suggestionsCache, selectedInterests, lastSearchResults]);

  // Debounced search with intelligent delay
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Use a shorter delay for single letters to improve responsiveness
    const delay = searchQuery.length <= 1 ? 100 : 300;

    searchTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(searchQuery);
    }, delay);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, fetchSuggestions]);

  const handleSelectSuggestion = (suggestion: Interest) => {
    setSelectedInterests(prev => [...prev, suggestion]);
    setSearchQuery('');
    // Don't clear suggestions when input is empty, show last search results
    Keyboard.dismiss();
  };

  const handleRemoveInterest = (interest: Interest) => {
    setSelectedInterests(prev =>
      prev.filter(
        item =>
          (item.id && interest.id && item.id !== interest.id) ||
          item.name !== interest.name,
      ),
    );
  };

  const handleCreateCustomInterest = () => {
    if (searchQuery.trim() === '') return;

    // Check if the input contains a separator like ":" or "-" which might indicate
    // primary and secondary parts (e.g., "Music: Rock" or "Programming - JavaScript")
    const separatorMatch = searchQuery.match(/([^:|-]+)[:|-]\s*(.+)/);

    let name = searchQuery.trim();
    let secondaryTerm = undefined;

    if (separatorMatch && separatorMatch.length === 3) {
      // If we find a separator, split into primary and secondary parts
      name = separatorMatch[1].trim();
      secondaryTerm = separatorMatch[2].trim();
    }

    // We don't format the name to preserve bracket notation
    // This allows custom interests to also have location information

    const newInterest: Interest = {
      name: name,
      secondary_term: secondaryTerm,
    };

    setSelectedInterests(prev => [...prev, newInterest]);
    setSearchQuery('');
    // Don't clear suggestions when input is empty, show last search results
    Keyboard.dismiss();
  };

  // Updated to handle both secondary_term as per API response and highlight matches
  const renderSuggestionItem = ({item}: {item: Interest}) => {
    // Highlight matching parts if there's a search query
    const highlightMatches = (text: string) => {
      if (!searchQuery || !text) return text;

      const normalizedQuery = searchQuery.toLowerCase().trim();
      const normalizedText = text.toLowerCase();

      if (!normalizedText.includes(normalizedQuery)) return text;

      const startIndex = normalizedText.indexOf(normalizedQuery);
      const endIndex = startIndex + normalizedQuery.length;

      return (
        <>
          {text.substring(0, startIndex)}
          <Text style={styles.highlightedText}>
            {text.substring(startIndex, endIndex)}
          </Text>
          {text.substring(endIndex)}
        </>
      );
    };

    const nameParts = splitInterestNameAndLocation(
      item.name || 'Unnamed Interest',
    );

    return (
      <TouchableOpacity
        style={styles.suggestionItem}
        onPress={() => handleSelectSuggestion(item)}>
        <View style={styles.suggestionContent}>
          <Text style={styles.suggestionText}>
            {item.emoji ? `${item.emoji} ` : ''}
            {highlightMatches(nameParts.main)}
            {nameParts.location && (
              <Text style={styles.locationText}>
                {' '}
                {highlightMatches(nameParts.location)}
              </Text>
            )}
          </Text>
          {item.secondary_term && (
            <Text style={styles.secondaryText}>
              {highlightMatches(item.secondary_term)}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Get a label for the search input placeholder
  const getSearchPlaceholder = () => {
    if (lastValidQuery && lastSearchResults.length > 0) {
      return `Search interests (last: "${lastValidQuery}")`;
    }
    return 'Search interests';
  };
  console.log(selectedInterests);
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContentContainer}>
        <View style={styles.headerContainer}>
          <Image
            source={require('./convoseLogo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <Text style={styles.headerTitle}>Convose</Text>
        </View>

        <View style={styles.mainContent}>
          <Text style={styles.sectionTitle}>What are your interests?</Text>
          <Text style={styles.sectionSubtitle}>
            Select or create interests to connect with like-minded people
          </Text>
          {/* <Text style={styles.sectionHint}>
            Pro tip: Search by both primary and secondary terms (e.g., "music"
            or "rock")
          </Text> */}

          {selectedInterests.length > 0 && (
            <View style={styles.selectedInterestsContainer}>
              <FlatList
                data={selectedInterests}
                keyExtractor={(item, index) =>
                  (item.id || item.name) + index.toString()
                }
                renderItem={({item}) => {
                  const nameParts = splitInterestNameAndLocation(item.name);

                  return (
                    <View style={styles.interestTag}>
                      <View style={styles.interestTagContent}>
                        <Text style={styles.interestTagText}>
                          {item.emoji ? `${item.emoji} ` : ''}
                          {nameParts.main}
                          {nameParts.location && (
                            <Text style={styles.interestTagLocationText}>
                              {' '}
                              {nameParts.location}
                            </Text>
                          )}
                        </Text>
                        {item.secondary_term && (
                          <Text style={styles.interestTagSecondaryText}>
                            {item.secondary_term}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRemoveInterest(item)}
                        style={styles.removeButton}>
                        <Text style={styles.removeButtonText}>×</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }}
                horizontal={false}
                numColumns={2}
                contentContainerStyle={styles.selectedInterestsList}
              />
            </View>
          )}

          <View style={styles.searchContainer}>
            <View style={styles.inputWrapper}>
              <Image
                source={require('./convoseLogo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <TextInput
                style={styles.searchInput}
                placeholder={getSearchPlaceholder()}
                placeholderTextColor="#888"
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {loading && (
                <ActivityIndicator
                  size="small"
                  color="#0066FF"
                  style={styles.loadingIndicator}
                />
              )}
            </View>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              <FlatList
                data={suggestions}
                keyExtractor={(item, index) =>
                  (item.id || item.name || '') + index.toString()
                }
                renderItem={renderSuggestionItem}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                inverted={true}
                keyboardShouldPersistTaps="always"
                removeClippedSubviews={false}
              />
            </View>
          )}

          {suggestions.length === 0 &&
            searchQuery.trim() !== '' &&
            !loading && (
              <View style={styles.createCustomContainer}>
                <Text style={styles.createCustomText}>
                  No matches found for "{searchQuery}"
                </Text>
                <TouchableOpacity
                  style={styles.createButton}
                  onPress={handleCreateCustomInterest}>
                  <Text style={styles.createButtonText}>
                    Create "{searchQuery}" as a new interest
                  </Text>
                </TouchableOpacity>
                <Text style={styles.createCustomHint}>
                  Tip: You can use "Primary: Secondary" format to add primary
                  and secondary terms
                </Text>
              </View>
            )}
        </View>

        {selectedInterests.length > 0 && (
          <View
            style={
              isKeyboardVisible
                ? styles.keyboardVisibleWrapper
                : styles.keyboardHiddenWrapper
            }>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={() =>
                Alert.alert(
                  'Interests saved',
                  selectedInterests.map(i => i.name).join(', '),
                )
              }>
              <Text style={styles.continueButtonText}>
                Continue with {selectedInterests.length} interest
                {selectedInterests.length !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default App;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: 100,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  headerLogo: {
    width: 48,
    height: 48,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 12,
    color: '#333',
  },
  mainContent: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  sectionSubtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
  },
  sectionHint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  searchContainer: {
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  logo: {
    width: 24,
    height: 24,
    marginLeft: 12,
  },
  searchInput: {
    flex: 1,
    height: 50,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#333',
  },
  loadingIndicator: {
    marginRight: 12,
  },
  suggestionsContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    marginBottom: 16,
  },
  suggestionItem: {
    padding: 14,
  },
  suggestionContent: {
    flexDirection: 'column',
  },
  suggestionText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  secondaryText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 14,
  },
  errorContainer: {
    padding: 10,
    backgroundColor: '#ffeeee',
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#ff0000',
    textAlign: 'center',
  },
  selectedInterestsContainer: {
    marginBottom: 24,
  },
  selectedInterestsList: {
    flexGrow: 1,
  },
  interestTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e1f5fe',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    margin: 4,
    maxWidth: '48%',
    justifyContent: 'space-between',
  },
  interestTagContent: {
    flexDirection: 'column',
    marginRight: 4,
  },
  interestTagText: {
    color: '#0277bd',
    fontSize: 14,
    fontWeight: '500',
  },
  interestTagSecondaryText: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  removeButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#0277bd',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  removeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  createCustomContainer: {
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    marginBottom: 16,
    alignItems: 'center',
  },
  createCustomText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  createButton: {
    backgroundColor: '#0066FF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  createButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  createCustomHint: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
  },
  keyboardHiddenWrapper: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
  },
  keyboardVisibleWrapper: {
    marginTop: 20,
    marginBottom: 20,
    marginHorizontal: 16,
  },
  continueButton: {
    backgroundColor: '#0066FF',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  highlightedText: {
    fontWeight: 'bold',
    backgroundColor: '#ffe0b2',
    color: '#e65100',
  },
  locationText: {
    color: '#888',
    fontWeight: 'normal',
    fontSize: 14,
  },
  interestTagLocationText: {
    color: '#888',
    fontWeight: 'normal',
    fontSize: 12,
    fontStyle: 'italic',
  },
});
