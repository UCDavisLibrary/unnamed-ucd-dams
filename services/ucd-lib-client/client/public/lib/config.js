module.exports = {
  fcrepoBasePath : '/fcrepo/rest',

  // facets to show on left side
  elasticSearch : {
    facets : {
      'fileFormats' : {
        label : 'File Format',
        type : 'facet'
      },
      'creators' : {
        label : 'Creator',
        type : 'facet'
      },
      'subjects_raw' : {
        label : 'Subject',
        type : 'facet'
      },
      yearPublished : {
        label : 'Published',
        type : 'range'
      }
    },

    textFields : ['name', 'description'],
    
    // max number of facets filter options
    maxFacetCount : 50
  }
}