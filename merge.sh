# this line will merge both movies at half size
/ffmpeg/ffmpeg/ffmpeg -i left.mpg -vf "[in] scale=iw/2:ih/2, pad=640:360:0:60 [left]; movie=right.mpg, scale=iw/2:ih/2 [right]; [left][right] overlay=320:60 [out]" merged.mpg


