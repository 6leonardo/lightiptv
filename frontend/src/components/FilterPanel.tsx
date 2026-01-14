type FilterPanelProps = {
    groups: string[];
    tabs: string[];
    setFilter: (filter: string) => void;
};

function FilterPanel({ groups, tabs, setFilter }: FilterPanelProps) {
    return (
        <div className="filter-panel">
            <div className="filter-section">
                <h3>Groups:</h3>
                <div className="filter-block">
                    {groups.length > 0 &&
                        groups.map((group) => (
                            <button
                                key={group}
                                type="button"
                                onClick={() => setFilter(`g:${group}`)}
                                className="filter-button"
                            >
                                {group}
                            </button>
                        ))}
                </div>
            </div>
            {tabs.length > 0 && (
                <div className="filter-section">
                    <h3>Tabs:</h3>
                    <div className="filter-block">
                        {tabs.map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setFilter(`t:${tab}`)}
                                className="filter-button"
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default FilterPanel;
