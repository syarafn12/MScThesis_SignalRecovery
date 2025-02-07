var roi = Small_scale_events_3areas;
var geography = 'asia'; // 'sa' (south america), 'africa' (africa), 'asia' (asia & pacific)
var scale = 10; //pixel spacing [m]; default is 10 m.

 //------------------------------ PLANET IMAGE ------------------------//
var nicfi = ee.ImageCollection('projects/planet-nicfi/assets/basemaps/asia');
var basemap= nicfi.filter(ee.Filter.date('2020-03-01','2020-07-01')).first();
var vis = {'bands':['R','G','B'],'min':64,'max':5454,'gamma':1.8};
Map.addLayer(basemap, vis, '2020 mosaic');
// If you have PlanetScope Imagery that already uploaded in Assets
var area = ee.FeatureCollection('projects/gee-planet-syarafina/assets/road_horizontal_area1');
 //------------------------------ RADD ALERT ------------------------//
var radd = ee.ImageCollection('projects/radar-wur/raddalert/v1');
//print('RADD image collection:', radd);

//-----------------
//Latest RADD alert
//-----------------
var latest_radd_alert =  ee.Image(radd.filterMetadata('layer','contains','alert')
                            .filterMetadata('geography','contains',geography)
                            .sort('system:time_end', false).first());

//print('Latest RADD alert '+ geography+':',latest_radd_alert);
//Map.addLayer(latest_radd_alert.select('Alert'), {}, 'Alert');
//RADD alert: 2 = unconfirmed (low confidence) alert; 3 = confirmed (high confidence) alert
//Map.addLayer(latest_radd_alert.select('Alert'), {min:2,max:3,palette:['blue','coral']}, 'RADD alert');
//RADD alert date: yyDOY (e.g. 21001 = 1 Jan 2021)
//Map.addLayer(latest_radd_alert.select('Date'), {min:19000,max:21000, palette: ['ffffcc','800026']}, 'RADD alert date');

//get version date
var version_date = latest_radd_alert.get('version_date').getInfo();
var google_drive_folder = 'thesis2';
// Clip to ROI
//var clip_area_first = latest_radd_alert.clip(area3)
var clip = latest_radd_alert.clip(roi); // clip to the area
var alertMask = clip.select('Alert').eq(3);
var maskedAlert = clip.updateMask(alertMask);
var dateBand = maskedAlert.select('Date');
var dateMask = dateBand.gte(20000).and(dateBand.lte(21000));
var filteredImage = dateBand.updateMask(dateMask);
Map.addLayer(filteredImage,{palette: ['ffffcc','800026']}, 'RADD Selected');
print(filteredImage, 'filteredImage');
// Convert to Vector (FeatureSelection)
var constantBand = filteredImage.addBands(ee.Image.constant(1));
var vectorAlert = constantBand.reduceToVectors({
  reducer: ee.Reducer.mean(), 
  geometry: roi, 
  scale: 10
});
//print(vectorAlert, 'vectorAlert (exported from QGIS)');
var features = vectorAlert.toList(vectorAlert.size());
var mergedGeometry = ee.Geometry.MultiPolygon([]);
var mergeGeometries = function(feature, initial) {
  var geometry = ee.Feature(feature).geometry();
  return ee.Geometry(initial).union(geometry, ee.ErrorMargin(1)); // Adding an error margin of 1 unit
};
mergedGeometry = ee.Geometry(features.iterate(mergeGeometries, mergedGeometry));
// Create an ee.Geometry object from the merged geometry
var mergedGeometryObject = ee.Geometry(mergedGeometry);
// EXPORT RADD TO TIFF IMAGE
Export.image.toDrive({
  image: filteredImage, 
  description: 'RADD_Alerts_2020',
  folder:google_drive_folder,
  region: vectorAlert,
  scale: 10,
  maxPixels: 10e12,
  crs: 'EPSG:4326'
  });
  
// --------------------------- PROCESSING SENTINEL-1 ------------------------------------------- //
          /* File: s1_ard.js
Version: v1.2
Date: 2021-03-10
Authors: Mullissa A., Vollrath A., Braun, C., Slagter B., Balling J., Gou Y., Gorelick N.,  Reiche J.
Description: This script creates an analysis ready S1 image collection.
License: This code is distributed under the MIT License.

    Parameter:
        START_DATE: The earliest date to include images for (inclusive).
        END_DATE: The latest date to include images for (exclusive).
        POLARIZATION: The Sentinel-1 image polarization to select for processing.
            'VV' - selects the VV polarization.
            'VH' - selects the VH polarization.
            "VVVH' - selects both the VV and VH polarization for processing.
        ORBIT:  The orbits to include. (string: BOTH, ASCENDING or DESCENDING)
        GEOMETRY: The region to include imagery within.
                  The user can interactively draw a bounding box within the map window or define the edge coordinates.
        APPLY_BORDER_NOISE_CORRECTION: (Optional) true or false options to apply additional Border noise correction:
        APPLY_SPECKLE_FILTERING: (Optional) true or false options to apply speckle filter
        SPECKLE_FILTER: Type of speckle filtering to apply (String). If the APPLY_SPECKLE_FILTERING parameter is true then the selected speckle filter type will be used.
            'BOXCAR' - Applies a boxcar filter on each individual image in the collection
            'LEE' - Applies a Lee filter on each individual image in the collection based on [1]
            'GAMMA MAP' - Applies a Gamma maximum a-posterior speckle filter on each individual image in the collection based on [2] & [3]
            'REFINED LEE' - Applies the Refined Lee speckle filter on each individual image in the collection
                                  based on [4]
            'LEE SIGMA' - Applies the improved Lee sigma speckle filter on each individual image in the collection
                                  based on [5]
        SPECKLE_FILTER_FRAMEWORK: is the framework where filtering is applied (String). It can be 'MONO' or 'MULTI'. In the MONO case
                                  the filtering is applied to each image in the collection individually. Whereas, in the MULTI case,
                                  the Multitemporal Speckle filter is applied based on  [6] with any of the above mentioned speckle filters.
        SPECKLE_FILTER_KERNEL_SIZE: is the size of the filter spatial window applied in speckle filtering. It must be a positive odd integer.
        SPECKLE_FILTER_NR_OF_IMAGES: is the number of images to use in the multi-temporal speckle filter framework. All images are selected before the date of image to be filtered.
                                    However, if there are not enough images before it then images after the date are selected.
        TERRAIN_FLATTENING : (Optional) true or false option to apply Terrain correction based on [7] & [8]. 
        TERRAIN_FLATTENING_MODEL : model to use for radiometric terrain normalization (DIRECT, or VOLUME)
        DEM : digital elevation model (DEM) to use (as EE asset)
        TERRAIN_FLATTENING_ADDITIONAL_LAYOVER_SHADOW_BUFFER : additional buffer parameter for passive layover/shadow mask in meters
        FORMAT : the output format for the processed collection. this can be 'LINEAR' or 'DB'.
        CLIP_TO_ROI: (Optional) Clip the processed image to the region of interest.
        SAVE_ASSETS : (Optional) Exports the processed collection to an asset.
        
    Returns:
        An ee.ImageCollection with an analysis ready Sentinel 1 imagery with the specified polarization images and angle band.
        
References
  [1]  J. S. Lee, “Digital image enhancement and noise filtering by use of local statistics,” 
    IEEE Pattern Anal. Machine Intell., vol. PAMI-2, pp. 165–168, Mar. 1980. 
  [2]  A. Lopes, R. Touzi, and E. Nezry, “Adaptative speckle filters and scene heterogeneity,
    IEEE Trans. Geosci. Remote Sensing, vol. 28, pp. 992–1000, Nov. 1990 
  [3]  Lopes, A.; Nezry, E.; Touzi, R.; Laur, H.  Maximum a posteriori speckle filtering and first204order texture models in SAR images.  
    10th annual international symposium on geoscience205and remote sensing. Ieee, 1990, pp. 2409–2412.
  [4] J.-S. Lee, M.R. Grunes, G. De Grandi. Polarimetric SAR speckle filtering and its implication for classification
    IEEE Trans. Geosci. Remote Sens., 37 (5) (1999), pp. 2363-2373.
  [5] Lee, J.-S.; Wen, J.-H.; Ainsworth, T.L.; Chen, K.-S.; Chen, A.J. Improved sigma filter for speckle filtering of SAR imagery. 
    IEEE Trans. Geosci. Remote Sens. 2009, 47, 202–213.
  [6] S. Quegan and J. J. Yu, “Filtering of multichannel SAR images, IEEE Trans Geosci. Remote Sensing, vol. 39, Nov. 2001.
  [7] Vollrath, A., Mullissa, A., & Reiche, J. (2020). Angular-Based Radiometric Slope Correction for Sentinel-1 on Google Earth Engine. 
    Remote Sensing, 12(11), [1867]. https://doi.org/10.3390/rs12111867
  [8] Hoekman, D.H.;  Reiche, J.   Multi-model radiometric slope correction of SAR images of complex terrain using a two-stage semi-empirical approach.
    Remote Sensing of Environment2222015,156, 1–10.
**/

var wrapper = require('users/adugnagirma/gee_s1_ard:wrapper');
var helper = require('users/adugnagirma/gee_s1_ard:utilities');

//--------------------------------p-------------------------------------------//
// DEFINE PARAMETERS
//---------------------------------------------------------------------------//

var parameter = {//1. Data Selection
              START_DATE: "2017-01-01",
              STOP_DATE: "2024-01-20",
              POLARIZATION:'VVVH',
              ORBIT : 'DESCENDING',
              //GEOMETRY: geometry, //uncomment if interactively selecting a region of interest
              GEOMETRY: mergedGeometryObject, //Uncomment if providing coordinates
              //GEOMETRY: ee.Geometry.Polygon([[[112.05, -0.25],[112.05, -0.45],[112.25, -0.45],[112.25, -0.25]]], null, false),
              //2. Additional Border noise correction
              APPLY_ADDITIONAL_BORDER_NOISE_CORRECTION: true,
              //3.Speckle filter
              APPLY_SPECKLE_FILTERING: true,
              SPECKLE_FILTER_FRAMEWORK: 'MULTI',
              SPECKLE_FILTER: 'LEE SIGMA',
              SPECKLE_FILTER_KERNEL_SIZE: 9,
              SPECKLE_FILTER_NR_OF_IMAGES: 10,
              //4. Radiometric terrain normalization
              APPLY_TERRAIN_FLATTENING: true,
              DEM: ee.Image('USGS/SRTMGL1_003'),
              TERRAIN_FLATTENING_MODEL: 'VOLUME',
              TERRAIN_FLATTENING_ADDITIONAL_LAYOVER_SHADOW_BUFFER: 0,
              //5. Output
              FORMAT : 'DB',
              CLIP_TO_ROI: true,
              SAVE_ASSETS: false
};

//---------------------------------------------------------------------------//
// DO THE JOB
//---------------------------------------------------------------------------//
      

//Preprocess the S1 collection
var s1_preprocces = wrapper.s1_preproc(parameter);

var s1 = s1_preprocces[0];
s1_preprocces = s1_preprocces[1];

//---------------------------------------------------------------------------//
// VISUALIZE
//---------------------------------------------------------------------------//

//Visulaization of the first image in the collection in RGB for VV, VH, images
var visparam = {};
if (parameter.POLARIZATION=='VVVH'){
     if (parameter.FORMAT=='DB'){
    var s1_preprocces_view = s1_preprocces.map(helper.add_ratio_lin).map(helper.lin_to_db2);
    var s1_view = s1.map(helper.add_ratio_lin).map(helper.lin_to_db2);
    visparam = {bands:['VV','VH','VVVH_ratio'],min: [-20, -25, 1],max: [0, -5, 15]};
    }
    else {
    var s1_preprocces_view = s1_preprocces.map(helper.add_ratio_lin);
    var s1_view = s1.map(helper.add_ratio_lin);
    visparam = {bands:['VV','VH','VVVH_ratio'], min: [0.01, 0.0032, 1.25],max: [1, 0.31, 31.62]};
    }
}
else {
    if (parameter.FORMAT=='DB') {
    s1_preprocces_view = s1_preprocces.map(helper.lin_to_db);
    s1_view = s1.map(helper.lin_to_db);
    visparam = {bands:[parameter.POLARIZATION],min: -25,max: 0};   
    }
    else {
    s1_preprocces_view = s1_preprocces;
    s1_view = s1;
    visparam = {bands:[parameter.POLARIZATION],min: 0,max: 0.2};
    }
}
//Map.centerObject(parameter.GEOMETRY, 15);
Map.centerObject(roi);
//Map.addLayer(s1_view.first(), visparam, 'First image in the input S1 collection', true);
//Map.addLayer(s1_preprocces_view.first(), visparam, 'First image in the processed S1 collection', true);
print(s1_preprocces_view, 's1_preprocces_view');

// ---------- MATCH FEATURE COLLECTION WITH SENTINEL1 IMAGE -------------- //
//var featureCollection = vectorAlert;
var commonProjection = s1_preprocces_view.first().select(0).projection();
// Reproject all images in the collection to have the same projection.
var reprojectedCollection = s1_preprocces_view.map(function(image) {
  return image.reproject(commonProjection);
});
// Convert feature collection to a raster.
var labelBand = vectorAlert.reduceToImage({
  properties: ['label'],
  reducer: ee.Reducer.first()
}).rename('label');
// Reproject labelBand to match the common projection and scale.
labelBand = labelBand.reproject({
  crs: commonProjection.crs(),
  scale: commonProjection.nominalScale()
});
// Function to add the label band to each image.
var addLabelBand = function(image) {
  return image.addBands(labelBand);
};
// Map the function over the reprojected image collection.
var newImageCollection = reprojectedCollection.map(addLabelBand);
//var newImageCollection = newImageCollection_before.clip(vectorAlert);
// Print the new image collection to check if the band was added.
//Map.addLayer(newImageCollection.first(), visparam, 'New Image Collection', true);

//---------------------------------------------------------------------------//
// EXPORT
//---------------------------------------------------------------------------//

//Convert format for export
if (parameter.FORMAT=='DB'){
  s1_preprocces = s1_preprocces.map(helper.lin_to_db);
}

//Save processed collection to asset
if(parameter.SAVE_ASSETS) {
helper.Download.ImageCollection.toAsset(s1_preprocces, '', 
               {scale: 10, 
               region: s1_preprocces.geometry(),
                type: 'float'});
}

var AlertVis = vectorAlert.style({
  color: 'red',
  width: 1,
  fillColor: 'FF000000'
});
//Map.addLayer(AlertVis, {}, 'Alert Selected');
var visRoi = new_3subdistricts.style({
  color: 'orange',
  width: 0.5,
  fillColor: 'FF000000'
});

Map.addLayer(AlertVis, {}, 'Alert Vector (exported from QGIS)');
//Map.addLayer(visRoadVertical, {}, 'Road Vertical');
Map.addLayer(visRoi, {}, 'Administrative 3 subdistricts');
// ------- EXPORT CSV -----
if (roi === road_horizontal) {
  var roi_name = 'road_horizontal_3areas';
} else if (roi === road_vertical) {
  var roi_name = 'road_vertical_3areas';
}  else if (roi === Big_scale_events_3areas) {
  var roi_name = 'Big_scale_events_3areas';
}  else {
  var roi_name = 'Small_scale_events_3areas'; // Provide a default value or handle other cases as needed
}
var pixelCount = newImageCollection.first().reduceRegion({
  reducer: ee.Reducer.count(), // Count the pixels
  scale: 10 // Adjust the scale 
});
print('Number of pixels in the polygon:', pixelCount);

// Pixel-based
var extractPixelValues = function(image) {
  // Sample the image at its native resolution to get pixel values and their locations
  var sampledImage = image.sample({
    region: mergedGeometryObject,
    scale: 10, // Change this to match the resolution the imagery
    geometries: true // This includes the geometry information in the output
  });
  // Map over the sampled pixels to extract center coordinates
  var sampledValues = sampledImage.map(function(feature) {
    var centroid = feature.geometry().centroid();
    var longitude = centroid.coordinates().get(0);
    var latitude = centroid.coordinates().get(1);
    // Get the timestamp as a date object
    var timestamp = ee.Date(image.get('system:time_start'));
    // Format timestamp to 'yyyy-MM-dd' string
    var formattedTimestamp = timestamp.format('YYYY-MM-dd');
    return feature.set({
      'longitude': longitude, 
      'latitude': latitude, 
      'timestamp': formattedTimestamp
    });
  });

  return sampledValues;
};
// Map over the image collection and extract values for each timestamp at pixel centers
var sampledData = newImageCollection.map(extractPixelValues);
// Flatten the resulting collection
var flattenedData = sampledData.flatten();

// Export the Backscatter Value to Google Drive as CSV
Export.table.toDrive({
  collection: flattenedData,
  description: roi_name + '_' + parameter.ORBIT+'_Pixels',
  folder: google_drive_folder,
  fileFormat: 'CSV' // Change to 'GeoJSON' or other formats if needed
});
// Assuming newImageCollection is final image collection with the added label band
var firstImage = s1_preprocces_view.first();
var castBandsToFloat32 = function(image) {
  // Cast each band to Float32.
  var floatImage = image.toFloat(); // This will cast all bands to Float32.
  // Copy properties from the original image to the new image with cast bands.
  floatImage = floatImage.copyProperties(image, image.propertyNames());
  return floatImage;
};
// Apply the function to the first image.
var imageToExport = castBandsToFloat32(firstImage);

Export.image.toDrive({
  image: imageToExport, // Image to be exported
  description: roi_name + '_' + parameter.ORBIT+'_ImageS1',
  folder: google_drive_folder, // Destination folder in Google Drive
  scale: 10, // Resolution in meters per pixel
  region: mergedGeometryObject, // Export region
  fileFormat: 'GeoTIFF', // File format
});

